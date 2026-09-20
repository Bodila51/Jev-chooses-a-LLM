#!/usr/bin/env npx tsx
/**
 * Demo dry-run — three tasks. Never invents dollar costs.
 */
import { runRoutedTask } from "../sdk-runner/execution.js";

const TASKS = [
  {
    name: "viral posts",
    task: "Draft three viral social posts about our product launch (do not publish)",
  },
  {
    name: "writing",
    task: "Write a clear technical blog outline about typed decision routers",
  },
  {
    name: "website",
    task: "Build a full multi-page marketing website with architecture and forms",
  },
];

async function main() {
  console.log("Jev Router for Cursor — demo dry-run\n");
  console.log("Cost figures are only shown when the Cursor SDK reports them; otherwise: unavailable.\n");

  for (const t of TASKS) {
    const started = Date.now();
    const result = await runRoutedTask({
      facts: { task: t.task, needsEdit: t.name === "website", needsWeb: t.name !== "writing" },
      dryRun: true,
      useMockJev: !process.env.TYPESAFE_API_KEY,
    });
    const elapsed = Date.now() - started;
    const cost =
      result.execution?.costUsd === undefined || result.execution.costUsd === "unavailable"
        ? "unavailable"
        : `$${result.execution.costUsd}`;

    console.log(`## ${t.name}`);
    console.log(`  task:        ${t.task}`);
    console.log(`  route:       ${result.finalTier} (subagent ${result.routing.subagent})`);
    console.log(`  confidence:  ${result.routing.confidence}`);
    console.log(`  model:       ${result.routing.model.displayName ?? result.routing.model.id} [${result.routing.model.source}]`);
    console.log(`  time_ms:     ${elapsed}`);
    console.log(`  cost:        ${cost}`);
    console.log(`  escalations: ${result.escalations.length}`);
    console.log(`  degraded:    ${result.routing.degradedRouting}`);
    console.log(`  reason:      ${result.routing.reason}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
