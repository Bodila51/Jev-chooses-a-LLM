import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { TelemetryEvent, RouterConfig } from "./types.js";
import { taskDigest } from "./redaction.js";

export function createTelemetryWriter(config: RouterConfig, dirHint?: string) {
  const dir = dirHint || process.env.JEV_ROUTER_TELEMETRY_DIR || resolve(process.cwd(), "telemetry");

  function ensureDir() {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function log(event: Omit<TelemetryEvent, "ts"> & { task?: string }): TelemetryEvent {
    const { task, ...rest } = event;
    const record: TelemetryEvent = {
      ts: new Date().toISOString(),
      ...rest,
      taskDigest: task !== undefined ? taskDigest(task, config.logPromptContent) : rest.taskDigest,
    };
    try {
      ensureDir();
      const day = record.ts.slice(0, 10);
      appendFileSync(resolve(dir, `events-${day}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // Telemetry must never break routing
    }
    return record;
  }

  return { log, dir };
}
