import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routeTask, statusPayload } from "../mcp/router.js";
import { createMockTypeSafeClient } from "../mcp/typesafe-client.js";
import { mergeConfig } from "../shared/config.js";
import { pickTierModels } from "../sdk-runner/model-catalog.js";
import { runRoutedTask } from "../sdk-runner/execution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenarios = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/scenarios.json"), "utf8"),
) as Array<{
  id: string;
  task: string;
  expectTier?: string;
  expectApproval?: string[];
}>;

describe("routeTask with mock Jev", () => {
  it("routes trivial rename toward cost (policy permitting)", async () => {
    const r = await routeTask(
      { task: "Rename variable foo to bar — trivial one-line rename", reversible: true },
      { useMock: true, client: createMockTypeSafeClient(), dryRun: true, telemetry: false },
    );
    assert.equal(r.tier, "cost");
    assert.equal(r.subagent, "jev-cost");
    assert.equal(r.jevUsed, true);
  });

  it("routes security to intelligence", async () => {
    const r = await routeTask(
      { task: "Security audit for credential leaks and XSS" },
      { useMock: true, dryRun: true, telemetry: false },
    );
    assert.equal(r.tier, "intelligence");
  });

  it("low confidence fixture forced to balanced", async () => {
    const r = await routeTask(
      { task: "ambiguous task without keywords" },
      {
        useMock: true,
        client: createMockTypeSafeClient({ tier: "cost", confidence: 0.5 }),
        dryRun: true,
        telemetry: false,
      },
    );
    assert.equal(r.tier, "balanced");
  });

  it("status payload reports hard rules", () => {
    const s = statusPayload(mergeConfig());
    assert.equal(s.enabled, true);
    assert.ok(s.hardRules.length >= 5);
  });
});

describe("scenario fixtures (11)", () => {
  for (const sc of scenarios) {
    it(`scenario ${sc.id}`, async () => {
      const r = await routeTask(
        { task: sc.task },
        { useMock: true, dryRun: true, telemetry: false },
      );
      if (sc.expectTier) {
        assert.equal(r.tier, sc.expectTier, `${sc.id} expected ${sc.expectTier} got ${r.tier}`);
      }
      if (sc.expectApproval) {
        for (const a of sc.expectApproval) {
          assert.ok(r.approvalReasons.includes(a), `${sc.id} missing approval ${a}`);
        }
        assert.equal(r.requireApproval, true);
      }
    });
  }
});

describe("model catalog — never invent IDs", () => {
  it("uses auto-smart optimize_for when present", () => {
    const cfg = mergeConfig();
    const map = pickTierModels(
      [
        {
          id: "auto-smart",
          parameters: [
            {
              id: "optimize_for",
              values: [{ value: "cost" }, { value: "balanced" }, { value: "intelligence" }],
            },
          ],
        },
      ],
      cfg,
    );
    assert.equal(map.cost.id, "auto-smart");
    assert.deepEqual(map.cost.params, [{ id: "optimize_for", value: "cost" }]);
    assert.equal(map.cost.source, "auto-smart");
  });

  it("falls back only to catalog or documented static IDs", () => {
    const cfg = mergeConfig();
    const map = pickTierModels([{ id: "composer-2.5", displayName: "Composer 2.5" }], cfg);
    assert.equal(map.balanced.id, "composer-2.5");
    assert.ok(map.balanced.source === "catalog-fallback" || map.balanced.source === "static-fallback");
  });
});

describe("SDK dry-run + escalation", () => {
  it("dry-run does not need CURSOR_API_KEY", async () => {
    const result = await runRoutedTask({
      facts: { task: "Research TypeScript routers", needsWeb: true },
      dryRun: true,
      useMockJev: true,
    });
    assert.equal(result.execution?.status, "dry-run");
    assert.equal(result.execution?.costUsd, "unavailable");
    assert.ok(result.routing.tier);
  });

  it("simulates cost→balanced escalation", async () => {
    const result = await runRoutedTask({
      facts: { task: "trivial one-line rename foo to bar" },
      dryRun: true,
      useMockJev: true,
      simulateFailure: { cost: "cost tier failed" },
    });
    assert.ok(result.escalations.length >= 1);
    assert.equal(result.escalations[0]!.to, "balanced");
  });
});
