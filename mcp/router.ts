import type { TaskFacts, RouterConfig, RouteDecision, ResolvedRoute } from "../shared/types.js";
import { loadConfig } from "../shared/config.js";
import { createTelemetryWriter } from "../shared/telemetry.js";
import { applyHardPolicy, detectSensitivity } from "./policy.js";
import {
  askJevRoute,
  createHttpTypeSafeClient,
  createMockTypeSafeClient,
  type TypeSafeClient,
} from "./typesafe-client.js";
import type { ModelSelection } from "../shared/types.js";

export interface RouteOptions {
  config?: RouterConfig;
  client?: TypeSafeClient;
  /** Force mock even if TYPESAFE_API_KEY is set (tests). */
  useMock?: boolean;
  dryRun?: boolean;
  modelResolver?: (tier: RouteDecision["tier"], config: RouterConfig) => Promise<{
    model: ModelSelection;
    catalogAvailable: boolean;
  }>;
  telemetry?: boolean;
}

export async function routeTask(facts: TaskFacts, opts: RouteOptions = {}): Promise<ResolvedRoute> {
  const config = opts.config ?? loadConfig();
  const telemetry = opts.telemetry !== false ? createTelemetryWriter(config) : null;
  const started = Date.now();
  const enriched = detectSensitivity(facts);

  if (!config.enabled || enriched.bypass) {
    const decision = applyHardPolicy(enriched, null, config, { bypassed: true });
    const resolved = await resolveModel(decision, config, opts);
    telemetry?.log({
      event: "route_bypass",
      tier: decision.tier,
      reason: decision.reason,
      modelId: resolved.model.id,
      modelSource: resolved.model.source,
      durationMs: Date.now() - started,
      task: facts.task,
    });
    return resolved;
  }

  let client: TypeSafeClient;
  let degraded = false;
  let jevAnswer = null;

  const hasKey = Boolean(process.env.TYPESAFE_API_KEY);
  if (opts.useMock || opts.client) {
    client = opts.client ?? createMockTypeSafeClient();
  } else if (hasKey) {
    client = createHttpTypeSafeClient(config);
  } else {
    // No key: use mock heuristics for dry-run/demo; mark degraded only if live path expected
    client = createMockTypeSafeClient();
    if (!opts.dryRun) degraded = true;
  }

  try {
    jevAnswer = await askJevRoute(client, enriched, config);
  } catch (err) {
    degraded = true;
    telemetry?.log({
      event: "jev_error",
      reason: err instanceof Error ? err.message : String(err),
      task: facts.task,
    });
  }

  const decision = applyHardPolicy(enriched, jevAnswer, config, {
    degraded: degraded || (!jevAnswer && true),
    escalationsUsed: facts.priorFailure ? 1 : 0,
  });

  // If we used mock only because key missing and not dry-run, ensure degradedRouting
  if (!hasKey && !opts.useMock && !opts.client && !opts.dryRun) {
    decision.degradedRouting = true;
    if (!decision.policyOverrides.includes("jev_unavailable→balanced") && !jevAnswer) {
      // keep decision but flag
      decision.degradedRouting = true;
    }
  }

  // When Jev threw, force balanced + degraded (hard rule 8)
  if (degraded && !jevAnswer) {
    const forced = applyHardPolicy(enriched, null, config, { degraded: true });
    const resolved = await resolveModel(forced, config, opts);
    telemetry?.log({
      event: "route_degraded",
      tier: forced.tier,
      confidence: forced.confidence,
      degradedRouting: true,
      reason: forced.reason,
      modelId: resolved.model.id,
      modelSource: resolved.model.source,
      durationMs: Date.now() - started,
      task: facts.task,
    });
    return resolved;
  }

  const resolved = await resolveModel(decision, config, opts);
  telemetry?.log({
    event: opts.dryRun ? "dry_run_route" : "route",
    tier: decision.tier,
    confidence: decision.confidence,
    degradedRouting: decision.degradedRouting,
    reason: decision.reason,
    modelId: resolved.model.id,
    modelSource: resolved.model.source,
    durationMs: Date.now() - started,
    task: facts.task,
    meta: {
      subagent: decision.subagent,
      requireApproval: decision.requireApproval,
      approvalReasons: decision.approvalReasons,
      policyOverrides: decision.policyOverrides,
    },
  });
  return resolved;
}

async function resolveModel(
  decision: RouteDecision,
  config: RouterConfig,
  opts: RouteOptions,
): Promise<ResolvedRoute> {
  if (opts.modelResolver) {
    const { model, catalogAvailable } = await opts.modelResolver(decision.tier, config);
    return { ...decision, model, catalogAvailable };
  }
  // Default: static fallback placeholder (SDK runner injects real catalog)
  return {
    ...decision,
    model: {
      id: config.fallbackModels[decision.tier],
      params: undefined,
      source: "static-fallback",
      displayName: `static:${decision.tier}`,
    },
    catalogAvailable: false,
  };
}

export function statusPayload(config?: RouterConfig) {
  const cfg = config ?? loadConfig();
  return {
    enabled: cfg.enabled,
    defaultMode: cfg.defaultMode,
    confidenceThreshold: cfg.confidenceThreshold,
    maximumEscalations: cfg.maximumEscalations,
    maximumTaskCostUsd: cfg.maximumTaskCostUsd,
    showRoutingTrace: cfg.showRoutingTrace,
    logPromptContent: cfg.logPromptContent,
    requireApprovalFor: cfg.requireApprovalFor,
    typesafeConfigured: Boolean(process.env.TYPESAFE_API_KEY),
    cursorConfigured: Boolean(process.env.CURSOR_API_KEY),
    nodeVersion: process.version,
    hardRules: [
      "confidence < threshold → BALANCED (from COST)",
      "security-sensitive → INTELLIGENCE",
      "financial / production deploy → INTELLIGENCE + approval",
      "send/delete email, publish → approval required",
      "COST fail → BALANCED → INTELLIGENCE → stop; max 2 escalations",
      "Jev unavailable → BALANCED + degradedRouting",
    ],
  };
}
