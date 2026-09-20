import type { TaskFacts, RouterConfig, RouteTier } from "../shared/types.js";
import { loadConfig } from "../shared/config.js";
import { routeTask } from "../mcp/router.js";
import { escalate, initialEscalationState } from "../mcp/policy.js";
import { resolveModelForTier, createCursorCatalogClient } from "./model-catalog.js";
import { executeWithCursor, type RunResultSummary } from "./cursor-client.js";
import { createTelemetryWriter } from "../shared/telemetry.js";

export interface RunTaskOptions {
  facts: TaskFacts;
  config?: RouterConfig;
  dryRun?: boolean;
  cwd?: string;
  cloud?: boolean;
  cloudRepos?: Array<{ url: string; startingRef?: string }>;
  /** Inject failures for tests: map of tier → fail reason */
  simulateFailure?: Partial<Record<RouteTier, string>>;
  useMockJev?: boolean;
  /** When true, proceed despite requireApproval gates (financial/prod/etc). */
  approve?: boolean;
}

export interface RunTaskResult {
  routing: Awaited<ReturnType<typeof routeTask>>;
  execution?: RunResultSummary;
  escalations: Array<{ from: RouteTier; to: RouteTier | null; reason: string }>;
  stopped: boolean;
  finalTier: RouteTier;
}

export async function runRoutedTask(opts: RunTaskOptions): Promise<RunTaskResult> {
  const config = opts.config ?? loadConfig();
  const telemetry = createTelemetryWriter(config);
  const catalogClient = opts.dryRun ? null : await createCursorCatalogClient();

  const routing = await routeTask(opts.facts, {
    config,
    dryRun: opts.dryRun,
    useMock: opts.useMockJev ?? !process.env.TYPESAFE_API_KEY,
    modelResolver: async (tier) => {
      const r = await resolveModelForTier(tier, config, catalogClient);
      if (opts.dryRun && !r.catalogAvailable) {
        return {
          model: {
            id: `dry-run:${tier}`,
            params: [{ id: "optimize_for", value: tier }],
            source: "dry-run-placeholder",
            displayName: `dry-run auto-smart/${tier}`,
          },
          catalogAvailable: false,
        };
      }
      return { model: r.model, catalogAvailable: r.catalogAvailable };
    },
  });

  if (routing.requireApproval && !opts.dryRun && !opts.approve) {
    telemetry.log({
      event: "approval_required",
      tier: routing.tier,
      reason: routing.approvalReasons.join(","),
      task: opts.facts.task,
    });
    return {
      routing,
      escalations: [],
      stopped: true,
      finalTier: routing.tier,
      execution: {
        status: "cancelled",
        error: `Human approval required: ${routing.approvalReasons.join(", ")}`,
        costUsd: "unavailable",
        model: routing.model,
      },
    };
  }

  let esc = initialEscalationState(routing.tier);
  const escalations: RunTaskResult["escalations"] = [];
  let currentTier: RouteTier = routing.tier;
  let currentModel = routing.model;
  let stopped = false;
  let lastExec: RunResultSummary | undefined;

  // At least one attempt
  for (;;) {
    if (opts.simulateFailure?.[currentTier]) {
      const failReason = opts.simulateFailure[currentTier]!;
      const step = escalate(esc, failReason, config, false);
      escalations.push({ from: esc.currentTier, to: step.nextTier, reason: step.reason });
      esc = step.state;
      if (step.stop || !step.nextTier) {
        stopped = true;
        lastExec = {
          status: "error",
          error: failReason,
          costUsd: "unavailable",
          model: currentModel,
        };
        break;
      }
      currentTier = step.nextTier;
      const resolved = await resolveModelForTier(currentTier, config, catalogClient);
      currentModel = opts.dryRun
        ? {
            id: `dry-run:${currentTier}`,
            params: [{ id: "optimize_for", value: currentTier }],
            source: "dry-run-placeholder",
          }
        : resolved.model;
      continue;
    }

    lastExec = await executeWithCursor({
      prompt: opts.facts.task,
      model: currentModel,
      cwd: opts.cwd,
      cloud: opts.cloud,
      cloudRepos: opts.cloudRepos,
      dryRun: opts.dryRun,
    });

    telemetry.log({
      event: opts.dryRun ? "dry_run_exec" : "exec",
      tier: currentTier,
      modelId: currentModel.id,
      modelSource: currentModel.source,
      durationMs: lastExec.durationMs,
      costUsd: lastExec.costUsd,
      task: opts.facts.task,
      meta: { status: lastExec.status, escalationsUsed: esc.escalationsUsed },
    });

    if (lastExec.status === "finished" || lastExec.status === "dry-run") {
      stopped = false;
      break;
    }

    const failReason = lastExec.error || `status=${lastExec.status}`;
    const step = escalate(esc, failReason, config, false);
    escalations.push({ from: esc.currentTier, to: step.nextTier, reason: step.reason });
    esc = step.state;
    if (step.stop || !step.nextTier) {
      stopped = true;
      break;
    }
    currentTier = step.nextTier;
    const resolved = await resolveModelForTier(currentTier, config, catalogClient);
    currentModel = opts.dryRun
      ? {
          id: `dry-run:${currentTier}`,
          params: [{ id: "optimize_for", value: currentTier }],
          source: "dry-run-placeholder",
        }
      : resolved.model;
  }

  return {
    routing: { ...routing, tier: currentTier, model: currentModel, escalationsUsed: esc.escalationsUsed },
    execution: lastExec,
    escalations,
    stopped,
    finalTier: currentTier,
  };
}
