import type {
  TaskFacts,
  RouteTier,
  RouterConfig,
  JevRouteAnswer,
  RouteDecision,
  EscalationState,
  ApprovalAction,
} from "../shared/types.js";
import { SUBAGENT_FOR_TIER, TIER_ORDER } from "../shared/types.js";

const BYPASS_MARKERS = ["bypass jev", "/jev-bypass", "no jev", "jev-bypass"];

const SECURITY_RE =
  /\b(security|vulnerabilit|cve|auth(entication|orization)?|secret|credential|encrypt|decrypt|xss|csrf|injection|privilege|pentest|exploit)\b/i;
const FINANCIAL_RE =
  /\b(payment|invoice|refund|payroll|wire transfer|bank account|financial|billing|charge|stripe|pci)\b/i;
const PROD_DEPLOY_RE =
  /\b(production deploy|deploy to prod(?:uction)?|prod deploy|release to production|ship to production)\b/i;
const PUBLISH_RE = /\b(?<!do not )(?<!don't )(publish|tweet|post to (x|twitter|linkedin)|release blog)\b/i;
const SEND_EMAIL_RE = /\b(send (an? )?email|email (the )?(user|customer|team)|mail to)\b/i;
const DELETE_RE = /\b(delete (all|data|records|users|database)|drop table|rm -rf|destroy)\b/i;

export function detectSensitivity(facts: TaskFacts): TaskFacts {
  const text = `${facts.task} ${facts.objective ?? ""}`;
  const lower = text.toLowerCase();
  const negatedPublish = /\b(do not|don't|dont)\s+publish\b/i.test(text);
  const negatedSend = /\b(do not|don't|dont)\s+send\b/i.test(text);
  return {
    ...facts,
    securitySensitive: facts.securitySensitive ?? SECURITY_RE.test(text),
    financial: facts.financial ?? FINANCIAL_RE.test(text),
    productionDeploy: facts.productionDeploy ?? PROD_DEPLOY_RE.test(text),
    publish: facts.publish ?? (PUBLISH_RE.test(text) && !negatedPublish),
    sendEmail: facts.sendEmail ?? (SEND_EMAIL_RE.test(text) && !negatedSend),
    deleteData: facts.deleteData ?? DELETE_RE.test(text),
    bypass: facts.bypass ?? BYPASS_MARKERS.some((m) => lower.includes(m)),
  };
}

export function nextTier(current: RouteTier): RouteTier | null {
  const idx = TIER_ORDER.indexOf(current);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1]!;
}

/**
 * Hard policy rules applied AFTER Jev (or on degradation).
 * Deterministic — never invented by the LLM.
 */
export function applyHardPolicy(
  facts: TaskFacts,
  jev: JevRouteAnswer | null,
  config: RouterConfig,
  opts?: { degraded?: boolean; bypassed?: boolean; escalationsUsed?: number },
): RouteDecision {
  const f = detectSensitivity(facts);
  const overrides: string[] = [];
  const approvalReasons: string[] = [];
  let tier: RouteTier = jev?.tier ?? config.defaultMode;
  let confidence = jev?.confidence ?? 0;
  let degraded = Boolean(opts?.degraded);
  const bypassed = Boolean(opts?.bypassed || f.bypass || !config.enabled);
  const escalationsUsed = opts?.escalationsUsed ?? 0;

  if (bypassed) {
    tier = config.defaultMode;
    return finalize(tier, confidence, "bypass or disabled — using defaultMode", overrides, [], false, true, degraded, escalationsUsed, config, f, Boolean(jev));
  }

  if (!jev) {
    tier = "balanced";
    degraded = true;
    overrides.push("jev_unavailable→balanced");
    confidence = 0;
  } else {
    // Rule 1: low confidence → BALANCED
    if (confidence < config.confidenceThreshold) {
      if (tier === "cost") {
        tier = "balanced";
        overrides.push(`confidence<${config.confidenceThreshold}→balanced`);
      }
    }
  }

  // Rule 2: security-sensitive → at least INTELLIGENCE
  if (f.securitySensitive) {
    if (tier !== "intelligence") {
      tier = "intelligence";
      overrides.push("security→intelligence");
    }
  }

  // Rule 3: financial / production deploy → INTELLIGENCE + approval
  if (f.financial || f.productionDeploy) {
    if (tier !== "intelligence") {
      tier = "intelligence";
      overrides.push(f.financial ? "financial→intelligence" : "production_deploy→intelligence");
    }
  }

  // Approvals
  const approvalMap: Array<{ flag: boolean | undefined; action: ApprovalAction; label: string }> = [
    { flag: f.sendEmail, action: "send_email", label: "send_email" },
    { flag: f.deleteData, action: "delete_data", label: "delete_data" },
    { flag: f.publish, action: "publish", label: "publish" },
    { flag: f.productionDeploy, action: "production_deploy", label: "production_deploy" },
    { flag: f.financial, action: "financial_transaction", label: "financial_transaction" },
  ];
  for (const a of approvalMap) {
    if (a.flag && config.requireApprovalFor.includes(a.action)) {
      approvalReasons.push(a.label);
    }
  }

  // Prior failure escalation hint already applied by caller; if priorFailure on cost, bump
  if (f.priorFailure?.tier === "cost" && tier === "cost") {
    tier = "balanced";
    overrides.push("prior_cost_fail→balanced");
  } else if (f.priorFailure?.tier === "balanced" && (tier === "cost" || tier === "balanced")) {
    tier = "intelligence";
    overrides.push("prior_balanced_fail→intelligence");
  }

  const reason =
    overrides.length > 0
      ? `policy: ${overrides.join("; ")}${jev ? `; jev=${jev.tier}@${confidence.toFixed(2)}` : ""}`
      : jev
        ? `jev chose ${jev.tier} @ ${confidence.toFixed(2)}`
        : "degraded default";

  return finalize(
    tier,
    confidence,
    reason,
    overrides,
    approvalReasons,
    approvalReasons.length > 0,
    false,
    degraded,
    escalationsUsed,
    config,
    f,
    Boolean(jev),
  );
}

function finalize(
  tier: RouteTier,
  confidence: number,
  reason: string,
  policyOverrides: string[],
  approvalReasons: string[],
  requireApproval: boolean,
  bypassed: boolean,
  degradedRouting: boolean,
  escalationsUsed: number,
  config: RouterConfig,
  f: TaskFacts,
  jevUsed: boolean,
): RouteDecision {
  return {
    tier,
    confidence,
    subagent: SUBAGENT_FOR_TIER[tier],
    optimizeFor: tier,
    reason,
    policyOverrides,
    requireApproval,
    approvalReasons,
    degradedRouting,
    bypassed,
    escalationsUsed,
    maxEscalations: config.maximumEscalations,
    showRoutingTrace: config.showRoutingTrace,
    jevUsed,
    factsSummary: {
      securitySensitive: Boolean(f.securitySensitive),
      financial: Boolean(f.financial),
      productionDeploy: Boolean(f.productionDeploy),
      publish: Boolean(f.publish),
      sendEmail: Boolean(f.sendEmail),
      deleteData: Boolean(f.deleteData),
      reversible: f.reversible,
      repoPresent: f.repoPresent,
      needsWeb: f.needsWeb,
      needsEdit: f.needsEdit,
      needsExternalSideEffect: f.needsExternalSideEffect,
    },
  };
}

/**
 * Escalation ladder: COST → BALANCED → INTELLIGENCE → stop.
 * Max 2 escalations. Never same-tier retry unless retryLikely.
 */
export function escalate(
  state: EscalationState,
  failReason: string,
  config: RouterConfig,
  retryLikely = false,
): { state: EscalationState; nextTier: RouteTier | null; stop: boolean; reason: string } {
  const max = config.maximumEscalations;
  if (state.escalationsUsed >= max) {
    const history = [...state.history, { tier: state.currentTier, outcome: "stop" as const, reason: `max escalations (${max}): ${failReason}` }];
    return {
      state: { ...state, history },
      nextTier: null,
      stop: true,
      reason: `stop after ${max} escalations`,
    };
  }

  const nxt = nextTier(state.currentTier);
  if (!nxt) {
    const history = [...state.history, { tier: state.currentTier, outcome: "stop" as const, reason: failReason }];
    return {
      state: { ...state, history },
      nextTier: null,
      stop: true,
      reason: "intelligence failed — stop",
    };
  }

  // Same-tier retry only if explicitly allowed
  if (retryLikely && state.currentTier === nxt) {
    return {
      state: {
        ...state,
        history: [...state.history, { tier: state.currentTier, outcome: "fail", reason: failReason }],
      },
      nextTier: state.currentTier,
      stop: false,
      reason: "same-tier retry allowed by error signal",
    };
  }

  const newState: EscalationState = {
    currentTier: nxt,
    escalationsUsed: state.escalationsUsed + 1,
    history: [...state.history, { tier: state.currentTier, outcome: "fail", reason: failReason }],
  };
  return {
    state: newState,
    nextTier: nxt,
    stop: false,
    reason: `escalate ${state.currentTier} → ${nxt}`,
  };
}

export function initialEscalationState(tier: RouteTier): EscalationState {
  return { currentTier: tier, escalationsUsed: 0, history: [] };
}
