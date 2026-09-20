/** Shared types for Jev Router for Cursor */

export type RouteTier = "cost" | "balanced" | "intelligence";

export type OptimizeFor = "cost" | "balanced" | "intelligence";

export type ApprovalAction =
  | "send_email"
  | "delete_data"
  | "publish"
  | "production_deploy"
  | "financial_transaction";

export interface TaskFacts {
  /** Raw user task text (may be redacted in logs). */
  task: string;
  /** Optional short objective summary. */
  objective?: string;
  /** Attachment metadata only (names/types/sizes), not content. */
  attachments?: Array<{ name?: string; mimeType?: string; sizeBytes?: number }>;
  repoPresent?: boolean;
  toolsAvailable?: string[];
  needsWeb?: boolean;
  needsAuth?: boolean;
  needsVision?: boolean;
  needsEdit?: boolean;
  needsTerminal?: boolean;
  needsExternalSideEffect?: boolean;
  reversible?: boolean;
  priorities?: string[];
  costLimitUsd?: number;
  priorFailure?: {
    tier: RouteTier;
    reason: string;
    retryLikely?: boolean;
  };
  /** Detected sensitivity flags from deterministic scanners. */
  securitySensitive?: boolean;
  financial?: boolean;
  productionDeploy?: boolean;
  publish?: boolean;
  sendEmail?: boolean;
  deleteData?: boolean;
  bypass?: boolean;
}

export interface JevRouteAnswer {
  tier: RouteTier;
  confidence: number;
  probabilities?: Record<string, number>;
  complexityScore?: number;
  approvalNoul?: number;
  raw?: unknown;
}

export interface RouteDecision {
  tier: RouteTier;
  confidence: number;
  subagent: "jev-cost" | "jev-balanced" | "jev-intelligence";
  optimizeFor: OptimizeFor;
  reason: string;
  policyOverrides: string[];
  requireApproval: boolean;
  approvalReasons: string[];
  degradedRouting: boolean;
  bypassed: boolean;
  escalationsUsed: number;
  maxEscalations: number;
  showRoutingTrace: boolean;
  jevUsed: boolean;
  factsSummary: Record<string, unknown>;
}

export interface ModelSelection {
  id: string;
  params?: Array<{ id: string; value: string }>;
  source: "auto-smart" | "catalog-fallback" | "static-fallback" | "dry-run-placeholder";
  displayName?: string;
}

export interface ResolvedRoute extends RouteDecision {
  model: ModelSelection;
  catalogAvailable: boolean;
}

export interface EscalationState {
  currentTier: RouteTier;
  escalationsUsed: number;
  history: Array<{ tier: RouteTier; outcome: "fail" | "success" | "stop"; reason: string }>;
}

export interface RouterConfig {
  enabled: boolean;
  defaultMode: RouteTier;
  confidenceThreshold: number;
  maximumEscalations: number;
  maximumTaskCostUsd: number;
  showRoutingTrace: boolean;
  logPromptContent: boolean;
  requireApprovalFor: ApprovalAction[];
  typesafe: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  fallbackModels: {
    cost: string;
    balanced: string;
    intelligence: string;
    note?: string;
  };
}

export interface TelemetryEvent {
  ts: string;
  event: string;
  tier?: RouteTier;
  confidence?: number;
  degradedRouting?: boolean;
  reason?: string;
  modelId?: string;
  modelSource?: string;
  durationMs?: number;
  costUsd?: number | "unavailable";
  escalationsUsed?: number;
  /** Never includes raw prompts unless logPromptContent is true (and still redacted). */
  taskDigest?: string;
  meta?: Record<string, unknown>;
}

export const TIER_ORDER: RouteTier[] = ["cost", "balanced", "intelligence"];

export const SUBAGENT_FOR_TIER: Record<RouteTier, RouteDecision["subagent"]> = {
  cost: "jev-cost",
  balanced: "jev-balanced",
  intelligence: "jev-intelligence",
};
