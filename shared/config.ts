import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { RouterConfig, RouteTier, ApprovalAction } from "./types.js";

export const DEFAULT_CONFIG: RouterConfig = {
  enabled: true,
  defaultMode: "balanced",
  confidenceThreshold: 0.7,
  maximumEscalations: 2,
  maximumTaskCostUsd: 1.0,
  showRoutingTrace: true,
  logPromptContent: false,
  requireApprovalFor: [
    "send_email",
    "delete_data",
    "publish",
    "production_deploy",
    "financial_transaction",
  ],
  typesafe: {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    timeoutMs: 15000,
  },
  fallbackModels: {
    cost: "composer-2.5",
    balanced: "claude-sonnet-5",
    intelligence: "claude-opus-5",
    note: "Verified catalog fallbacks when auto-smart is unavailable.",
  },
};

function isTier(v: unknown): v is RouteTier {
  return v === "cost" || v === "balanced" || v === "intelligence";
}

export function mergeConfig(partial?: Partial<RouterConfig> | null): RouterConfig {
  if (!partial) return { ...DEFAULT_CONFIG, typesafe: { ...DEFAULT_CONFIG.typesafe }, fallbackModels: { ...DEFAULT_CONFIG.fallbackModels }, requireApprovalFor: [...DEFAULT_CONFIG.requireApprovalFor] };
  return {
    enabled: partial.enabled ?? DEFAULT_CONFIG.enabled,
    defaultMode: isTier(partial.defaultMode) ? partial.defaultMode : DEFAULT_CONFIG.defaultMode,
    confidenceThreshold: typeof partial.confidenceThreshold === "number" ? partial.confidenceThreshold : DEFAULT_CONFIG.confidenceThreshold,
    maximumEscalations: typeof partial.maximumEscalations === "number" ? partial.maximumEscalations : DEFAULT_CONFIG.maximumEscalations,
    maximumTaskCostUsd: typeof partial.maximumTaskCostUsd === "number" ? partial.maximumTaskCostUsd : DEFAULT_CONFIG.maximumTaskCostUsd,
    showRoutingTrace: partial.showRoutingTrace ?? DEFAULT_CONFIG.showRoutingTrace,
    logPromptContent: partial.logPromptContent ?? DEFAULT_CONFIG.logPromptContent,
    requireApprovalFor: Array.isArray(partial.requireApprovalFor)
      ? (partial.requireApprovalFor as ApprovalAction[])
      : [...DEFAULT_CONFIG.requireApprovalFor],
    typesafe: {
      ...DEFAULT_CONFIG.typesafe,
      ...(partial.typesafe ?? {}),
    },
    fallbackModels: {
      ...DEFAULT_CONFIG.fallbackModels,
      ...(partial.fallbackModels ?? {}),
    },
  };
}

export function loadConfig(pathHint?: string): RouterConfig {
  const candidates = [
    pathHint,
    process.env.JEV_ROUTER_CONFIG,
    resolve(process.cwd(), "config.local.json"),
    resolve(process.cwd(), "config.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<RouterConfig>;
        return mergeConfig(raw);
      } catch {
        // fall through
      }
    }
  }
  return mergeConfig();
}
