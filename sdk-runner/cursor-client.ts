/**
 * Thin wrapper around @cursor/sdk Agent.create / send.
 * Loaded lazily; dry-run never requires the package.
 */
import type { ModelSelection } from "../shared/types.js";

export interface RunResultSummary {
  status: "finished" | "error" | "cancelled" | "dry-run";
  result?: string;
  error?: string;
  durationMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number | "unavailable";
  model?: ModelSelection;
  agentId?: string;
  requestId?: string;
}

export interface ExecuteOptions {
  prompt: string;
  model: ModelSelection;
  apiKey?: string;
  cwd?: string;
  cloud?: boolean;
  cloudRepos?: Array<{ url: string; startingRef?: string }>;
  dryRun?: boolean;
}

export async function executeWithCursor(opts: ExecuteOptions): Promise<RunResultSummary> {
  if (opts.dryRun) {
    return {
      status: "dry-run",
      result: undefined,
      durationMs: 0,
      costUsd: "unavailable",
      model: opts.model,
    };
  }

  const key = opts.apiKey ?? process.env.CURSOR_API_KEY;
  if (!key) {
    throw new Error("CURSOR_API_KEY required for live execution");
  }

  let Agent: {
    create: (o: Record<string, unknown>) => Promise<{
      agentId: string;
      send: (msg: string, o?: Record<string, unknown>) => Promise<{
        wait: () => Promise<{
          status: string;
          result?: string;
          error?: { message: string };
          durationMs?: number;
          usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
          requestId?: string;
          model?: unknown;
        }>;
      }>;
      getUsage?: () => Promise<{ cost?: { chargedCents: number } }>;
      [Symbol.asyncDispose]?: () => Promise<void>;
      close?: () => void;
    }>;
  };

  try {
    const mod = await import("@cursor/sdk");
    Agent = (mod as { Agent: typeof Agent }).Agent;
  } catch (err) {
    throw new Error(
      `Failed to load @cursor/sdk (requires Node >= 22.13): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const modelSelection = {
    id: opts.model.id,
    params: opts.model.params,
  };

  const createOpts: Record<string, unknown> = {
    apiKey: key,
    model: modelSelection,
  };
  if (opts.cloud) {
    createOpts.cloud = { repos: opts.cloudRepos ?? [] };
  } else {
    createOpts.local = { cwd: opts.cwd ?? process.cwd() };
  }

  const agent = await Agent.create(createOpts);
  try {
    const run = await agent.send(opts.prompt);
    const result = await run.wait();
    let costUsd: number | "unavailable" = "unavailable";
    try {
      if (agent.getUsage) {
        const usage = await agent.getUsage();
        if (usage.cost && typeof usage.cost.chargedCents === "number") {
          costUsd = usage.cost.chargedCents / 100;
        }
      }
    } catch {
      costUsd = "unavailable";
    }

    return {
      status: (result.status as RunResultSummary["status"]) || "finished",
      result: result.result,
      error: result.error?.message,
      durationMs: result.durationMs,
      usage: result.usage,
      costUsd,
      model: opts.model,
      agentId: agent.agentId,
      requestId: result.requestId,
    };
  } finally {
    if (agent[Symbol.asyncDispose]) {
      await agent[Symbol.asyncDispose]!();
    } else if (agent.close) {
      agent.close();
    }
  }
}
