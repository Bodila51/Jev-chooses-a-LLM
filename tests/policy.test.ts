import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyHardPolicy, escalate, detectSensitivity, initialEscalationState, nextTier } from "../mcp/policy.js";
import { mergeConfig } from "../shared/config.js";

const config = mergeConfig();

describe("detectSensitivity", () => {
  it("flags security", () => {
    const f = detectSensitivity({ task: "Fix authentication vulnerability in login" });
    assert.equal(f.securitySensitive, true);
  });
  it("flags financial", () => {
    const f = detectSensitivity({ task: "Process a Stripe payment refund" });
    assert.equal(f.financial, true);
  });
  it("flags production deploy", () => {
    const f = detectSensitivity({ task: "Deploy to production tonight" });
    assert.equal(f.productionDeploy, true);
  });
  it("detects bypass markers", () => {
    const f = detectSensitivity({ task: "please bypass jev for this" });
    assert.equal(f.bypass, true);
  });
});

describe("applyHardPolicy", () => {
  it("bumps low confidence cost → balanced", () => {
    const d = applyHardPolicy(
      { task: "maybe rename something" },
      { tier: "cost", confidence: 0.4 },
      config,
    );
    assert.equal(d.tier, "balanced");
    assert.ok(d.policyOverrides.some((x) => x.includes("confidence")));
  });

  it("forces intelligence for security", () => {
    const d = applyHardPolicy(
      { task: "audit XSS vulnerability" },
      { tier: "cost", confidence: 0.99 },
      config,
    );
    assert.equal(d.tier, "intelligence");
    assert.equal(d.subagent, "jev-intelligence");
  });

  it("forces intelligence + approval for financial", () => {
    const d = applyHardPolicy(
      { task: "change payroll wire transfer amounts" },
      { tier: "balanced", confidence: 0.9 },
      config,
    );
    assert.equal(d.tier, "intelligence");
    assert.equal(d.requireApproval, true);
    assert.ok(d.approvalReasons.includes("financial_transaction"));
  });

  it("requires approval for send email", () => {
    const d = applyHardPolicy(
      { task: "send an email to the customer about the outage" },
      { tier: "balanced", confidence: 0.9 },
      config,
    );
    assert.equal(d.requireApproval, true);
    assert.ok(d.approvalReasons.includes("send_email"));
  });

  it("Jev unavailable → balanced + degraded", () => {
    const d = applyHardPolicy({ task: "normal coding task" }, null, config, { degraded: true });
    assert.equal(d.tier, "balanced");
    assert.equal(d.degradedRouting, true);
  });

  it("bypass uses defaultMode", () => {
    const d = applyHardPolicy({ task: "x", bypass: true }, { tier: "intelligence", confidence: 1 }, config, {
      bypassed: true,
    });
    assert.equal(d.bypassed, true);
    assert.equal(d.tier, config.defaultMode);
  });

  it("disabled config bypasses", () => {
    const cfg = mergeConfig({ enabled: false });
    const d = applyHardPolicy({ task: "anything" }, { tier: "cost", confidence: 1 }, cfg);
    assert.equal(d.bypassed, true);
  });
});

describe("escalation ladder", () => {
  it("cost → balanced → intelligence → stop, max 2", () => {
    let s = initialEscalationState("cost");
    let step = escalate(s, "fail1", config);
    assert.equal(step.nextTier, "balanced");
    assert.equal(step.state.escalationsUsed, 1);
    s = step.state;
    step = escalate(s, "fail2", config);
    assert.equal(step.nextTier, "intelligence");
    assert.equal(step.state.escalationsUsed, 2);
    s = step.state;
    step = escalate(s, "fail3", config);
    assert.equal(step.stop, true);
    assert.equal(step.nextTier, null);
  });

  it("nextTier order", () => {
    assert.equal(nextTier("cost"), "balanced");
    assert.equal(nextTier("balanced"), "intelligence");
    assert.equal(nextTier("intelligence"), null);
  });
});
