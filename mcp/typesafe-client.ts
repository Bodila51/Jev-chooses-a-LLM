/**
 * Thin TypeSafe System One client (Choice / Score / Noul only).
 * POST https://api.typesafe.ai/v1/systemone
 */

import type { RouterConfig, TaskFacts, JevRouteAnswer, RouteTier } from "../shared/types.js";

export interface SystemOneQuestion {
  type: "choice" | "score" | "noul";
  instructions?: string;
  criteria?: Record<string, string> | string[];
}

export interface SystemOneRequest {
  model: string;
  state: string | Record<string, unknown>;
  questions: Record<string, SystemOneQuestion>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface TypeSafeClient {
  systemOne(req: SystemOneRequest): Promise<SystemOneResponse>;
}

export function createHttpTypeSafeClient(config: RouterConfig, apiKey?: string): TypeSafeClient {
  const key = apiKey ?? process.env.TYPESAFE_API_KEY ?? "";
  return {
    async systemOne(req: SystemOneRequest): Promise<SystemOneResponse> {
      if (!key) {
        throw new Error("TYPESAFE_API_KEY missing");
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), config.typesafe.timeoutMs);
      try {
        const res = await fetch(config.typesafe.baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(req),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`TypeSafe HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        return (await res.json()) as SystemOneResponse;
      } finally {
        clearTimeout(t);
      }
    },
  };
}

export function buildRoutingQuestions(): Record<string, SystemOneQuestion> {
  return {
    tier: {
      type: "choice",
      instructions:
        "Which Cursor execution tier is the cheapest that is still likely to complete this task successfully without retry? Prefer cost for trivial reversible edits; balanced for typical coding/research; intelligence for security, financial, production, or hard multi-step builds.",
      criteria: {
        cost: "Trivial or simple reversible work; rename, small edit, short lookup",
        balanced: "Normal coding, research, writing, multi-file but not high-risk",
        intelligence: "Security-sensitive, financial, production deploy, complex architecture, or high failure cost",
      },
    },
    complexity: {
      type: "score",
      instructions: "How complex is successful completion?",
      criteria: [
        "Trivial one-step",
        "Simple few-step",
        "Normal multi-step",
        "Heavy multi-system",
        "Critical high-stakes",
      ],
    },
    needs_approval: {
      type: "noul",
      instructions:
        "Does this task involve sending email, deleting data, publishing externally, production deploy, or a financial transaction that should require human approval before side effects?",
    },
  };
}

export function factsToState(facts: TaskFacts): Record<string, unknown> {
  return {
    task: facts.task.slice(0, 4000),
    objective: facts.objective ?? "",
    attachments_meta: facts.attachments ?? [],
    repo_present: Boolean(facts.repoPresent),
    tools: facts.toolsAvailable ?? [],
    needs_web: Boolean(facts.needsWeb),
    needs_auth: Boolean(facts.needsAuth),
    needs_vision: Boolean(facts.needsVision),
    needs_edit: Boolean(facts.needsEdit),
    needs_terminal: Boolean(facts.needsTerminal),
    needs_external_side_effect: Boolean(facts.needsExternalSideEffect),
    reversible: facts.reversible !== false,
    priorities: facts.priorities ?? [],
    cost_limit_usd: facts.costLimitUsd,
    prior_failure: facts.priorFailure ?? null,
    security_sensitive: Boolean(facts.securitySensitive),
    financial: Boolean(facts.financial),
    production_deploy: Boolean(facts.productionDeploy),
  };
}

function asTier(v: string): RouteTier | null {
  if (v === "cost" || v === "balanced" || v === "intelligence") return v;
  return null;
}

export async function askJevRoute(
  client: TypeSafeClient,
  facts: TaskFacts,
  config: RouterConfig,
): Promise<JevRouteAnswer> {
  const res = await client.systemOne({
    model: config.typesafe.model,
    state: factsToState(facts),
    questions: buildRoutingQuestions(),
  });

  const tierAns = res.answers.tier as ChoiceAnswer | undefined;
  const scoreAns = res.answers.complexity as ScoreAnswer | undefined;
  const noulAns = res.answers.needs_approval as NoulAnswer | undefined;

  const tier = asTier(tierAns?.choice ?? "") ?? "balanced";
  const confidence = typeof tierAns?.confidence === "number" ? tierAns.confidence : 0;

  return {
    tier,
    confidence,
    probabilities: tierAns?.probabilities,
    complexityScore: scoreAns?.score,
    approvalNoul: noulAns?.noul,
    raw: res,
  };
}

/** Deterministic mock for CI / dry-run without keys. */
export function createMockTypeSafeClient(fixture?: Partial<JevRouteAnswer>): TypeSafeClient {
  return {
    async systemOne(req: SystemOneRequest): Promise<SystemOneResponse> {
      // Heuristics use task/objective only — never match JSON key names like "financial":false
      let taskText = "";
      if (typeof req.state === "string") {
        taskText = req.state;
      } else if (req.state && typeof req.state === "object") {
        const s = req.state as Record<string, unknown>;
        taskText = `${s.task ?? ""} ${s.objective ?? ""}`;
      }
      let tier = fixture?.tier ?? "balanced";
      let confidence = fixture?.confidence ?? 0.85;

      if (/rename|typo|trivial|one.?line/i.test(taskText)) {
        tier = "cost";
        confidence = 0.92;
      } else if (/security|vulnerabilit|xss|credential|auth(entication)? middleware|production deploy|\bfinancial\b|\bpayment\b|stripe|payroll/i.test(taskText)) {
        tier = "intelligence";
        confidence = 0.88;
      } else if (/website|full.?stack|architecture|multi.?page/i.test(taskText)) {
        tier = "intelligence";
        confidence = 0.8;
      } else if (/research|summarize|draft|write|blog|triage|inbox|viral/i.test(taskText)) {
        tier = "balanced";
        confidence = 0.82;
      }

      if (fixture?.tier) tier = fixture.tier;
      if (typeof fixture?.confidence === "number") confidence = fixture.confidence;

      const approvalHint =
        /\bsend (an? )?email\b|\bdelete all\b|\bpublish\b(?!.*do not)|\bdeploy to production\b|\bstripe\b|\bpayroll\b/i.test(
          taskText,
        );

      return {
        model: "jev-mock",
        answers: {
          tier: {
            type: "choice",
            choice: tier,
            confidence,
            probabilities: {
              cost: tier === "cost" ? confidence : (1 - confidence) / 2,
              balanced: tier === "balanced" ? confidence : (1 - confidence) / 2,
              intelligence: tier === "intelligence" ? confidence : (1 - confidence) / 2,
            },
          },
          complexity: {
            type: "score",
            score: tier === "cost" ? 0.5 : tier === "balanced" ? 2 : 3.5,
            confidence: 0.8,
          },
          needs_approval: {
            type: "noul",
            noul: approvalHint ? 0.85 : 0.1,
          },
        },
      };
    },
  };
}
