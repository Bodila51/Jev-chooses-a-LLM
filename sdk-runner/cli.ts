#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
  }
}

loadDotEnv();

// Must re-exec BEFORE importing @cursor/sdk (ESM hoists static imports).
if (!process.execArgv.includes("--use-system-ca")) {
  const args = ["--use-system-ca", ...process.execArgv, ...process.argv.slice(1)];
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 1);
}

const { runRoutedTask } = await import("./execution.js");
const { routeTask, statusPayload } = await import("../mcp/router.js");
const { loadConfig } = await import("../shared/config.js");

function usage() {
  console.log(`jev-router — SDK runner

Usage:
  jev-router --dry-run "task text"
  jev-router --route-only "task text"
  jev-router --status
  jev-router --run "task text"          # requires CURSOR_API_KEY

Flags:
  --dry-run       Route + model resolve only (no Agent.create)
  --route-only    Jev+policy only
  --status        Print config / key presence
  --cwd <path>    Local workspace
  --cloud         Use cloud agent (optional)
  --approve       Proceed even if policy requires human approval
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(0);
  }

  if (args.includes("--status")) {
    console.log(JSON.stringify(statusPayload(loadConfig()), null, 2));
    return;
  }

  const dryRun = args.includes("--dry-run");
  const routeOnly = args.includes("--route-only");
  const runLive = args.includes("--run");
  const cloud = args.includes("--cloud");
  const approve = args.includes("--approve");
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx >= 0 ? args[cwdIdx + 1] : process.cwd();

  const taskParts = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      !(cwdIdx >= 0 && i === cwdIdx + 1) &&
      a !== "true",
  );
  const task = taskParts.join(" ").trim();
  if (!task) {
    usage();
    process.exit(1);
  }

  if (routeOnly) {
    const r = await routeTask(
      { task, repoPresent: true },
      { dryRun: true, useMock: !process.env.TYPESAFE_API_KEY },
    );
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const result = await runRoutedTask({
    facts: { task, repoPresent: true, needsEdit: true },
    dryRun: dryRun || (!runLive && !process.env.CURSOR_API_KEY),
    cwd,
    cloud,
    approve,
    useMockJev: !process.env.TYPESAFE_API_KEY,
  });

  const out = {
    ...result,
    note:
      result.execution?.costUsd === "unavailable"
        ? "Cost unavailable — not estimated."
        : undefined,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
