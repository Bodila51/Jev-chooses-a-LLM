import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Load project .env so Cursor-spawned MCP gets TYPESAFE_API_KEY without putting it in mcp.json. */
function loadDotEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }
  if (!process.env.JEV_ROUTER_CONFIG) {
    process.env.JEV_ROUTER_CONFIG = resolve(root, "config.json");
  }
}
loadDotEnv();

/**
 * Jev Router MCP server — tools: route, dry-run, status
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { routeTask, statusPayload } from "./router.js";
import { loadConfig } from "../shared/config.js";
import type { TaskFacts } from "../shared/types.js";

function asFacts(args: Record<string, unknown>): TaskFacts {
  return {
    task: String(args.task ?? args.prompt ?? ""),
    objective: args.objective != null ? String(args.objective) : undefined,
    repoPresent: args.repoPresent as boolean | undefined,
    needsWeb: args.needsWeb as boolean | undefined,
    needsAuth: args.needsAuth as boolean | undefined,
    needsVision: args.needsVision as boolean | undefined,
    needsEdit: args.needsEdit as boolean | undefined,
    needsTerminal: args.needsTerminal as boolean | undefined,
    needsExternalSideEffect: args.needsExternalSideEffect as boolean | undefined,
    reversible: args.reversible as boolean | undefined,
    securitySensitive: args.securitySensitive as boolean | undefined,
    financial: args.financial as boolean | undefined,
    productionDeploy: args.productionDeploy as boolean | undefined,
    publish: args.publish as boolean | undefined,
    sendEmail: args.sendEmail as boolean | undefined,
    deleteData: args.deleteData as boolean | undefined,
    bypass: args.bypass as boolean | undefined,
    toolsAvailable: Array.isArray(args.toolsAvailable) ? (args.toolsAvailable as string[]) : undefined,
    priorities: Array.isArray(args.priorities) ? (args.priorities as string[]) : undefined,
    costLimitUsd: typeof args.costLimitUsd === "number" ? args.costLimitUsd : undefined,
    attachments: Array.isArray(args.attachments)
      ? (args.attachments as TaskFacts["attachments"])
      : undefined,
  };
}

const server = new Server(
  { name: "jev-router", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "jev_route",
      description:
        "Route a task through TypeSafe Jev + hard policy. Returns COST/BALANCED/INTELLIGENCE tier, subagent name, confidence, approval flags. Parent agents MUST call this before delegating work.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Raw user task" },
          objective: { type: "string" },
          repoPresent: { type: "boolean" },
          needsWeb: { type: "boolean" },
          needsEdit: { type: "boolean" },
          needsTerminal: { type: "boolean" },
          needsExternalSideEffect: { type: "boolean" },
          reversible: { type: "boolean" },
          securitySensitive: { type: "boolean" },
          financial: { type: "boolean" },
          productionDeploy: { type: "boolean" },
          publish: { type: "boolean" },
          sendEmail: { type: "boolean" },
          deleteData: { type: "boolean" },
          bypass: { type: "boolean" },
        },
        required: ["task"],
      },
    },
    {
      name: "jev_dry_run",
      description:
        "Dry-run routing only — no Cursor Agent.create, no side effects. Shows tier, confidence, resolved model placeholder, policy overrides.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string" },
          objective: { type: "string" },
          repoPresent: { type: "boolean" },
          needsWeb: { type: "boolean" },
          needsEdit: { type: "boolean" },
          securitySensitive: { type: "boolean" },
          financial: { type: "boolean" },
          productionDeploy: { type: "boolean" },
        },
        required: ["task"],
      },
    },
    {
      name: "jev_status",
      description: "Return router config, hard rules, and whether TYPESAFE_API_KEY / CURSOR_API_KEY are present.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const config = loadConfig();

  try {
    if (name === "jev_status") {
      return {
        content: [{ type: "text", text: JSON.stringify(statusPayload(config), null, 2) }],
      };
    }

    if (name === "jev_route" || name === "jev_dry_run") {
      const facts = asFacts(args);
      if (!facts.task.trim()) {
        return {
          isError: true,
          content: [{ type: "text", text: "task is required" }],
        };
      }
      const dryRun = name === "jev_dry_run";
      const result = await routeTask(facts, {
        config,
        dryRun,
        useMock: !process.env.TYPESAFE_API_KEY,
      });
      const payload = {
        ...result,
        mode: dryRun ? "dry-run" : "route",
        instruction: dryRun
          ? "Do not execute. Show this routing decision to the user."
          : `Delegate the main task to subagent ${result.subagent}. Do not perform the main work in the parent unless routing failed and fallback allows.`,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
