# Jev Router for Cursor

**Cursor executes. LLMs write and build. Jev decides how much intelligence the task deserves.**

Honest promise: pick the **cheapest available route likely to complete successfully under policy** — not a mathematically optimal model.

TypeSafe **Jev** is a decision layer only (Choice / Score / Noul). It does not browse, write prose, edit files, or operate accounts. Env: `TYPESAFE_API_KEY`.


## Personal smoke test

In the Cursor Agents window for this project, paste:

```text
Find today's most popular public posts about TypeSafe Jev on X/Twitter (by views if available). Rank the top 5 and say why each is popular. Do not log in or post anything.
```

Expected: Jev routes first (often BALANCED), then work uses web/research tools. In chat this is soft routing; for hard model switch use SDK `--run`.

## Chat vs SDK (read this)

| Mode | What changes | What does not |
| --- | --- | --- |
| Cursor Chat + MCP | Parent calls `jev_route`, may delegate to `jev-cost` / `jev-balanced` / `jev-intelligence` | Parent chat model is not hot-swapped |
| SDK `--run` | Jev decides tier, then `Agent.create` uses the resolved model from your catalog | Needs `CURSOR_API_KEY` |

Approval gates (`production_deploy`, `financial_transaction`, …) stop SDK runs unless you pass `--approve`.

## What this product is

| Mode | Enforcement | How routing works |
| --- | --- | --- |
| **Chat (soft)** | Rule + MCP + subagents | Parent calls `jev_route`, then delegates to `jev-cost` / `jev-balanced` / `jev-intelligence`. Does **not** hot-swap the parent model. |
| **SDK (hard)** | Code path | `route → validate → discover models → Agent.create/send` with selected model / `auto-smart` `optimize_for`. Supports dry-run and escalation. |

## Hard routing rules (deterministic)

1. `confidence < 0.70` → **BALANCED**
2. Security-sensitive → at least **INTELLIGENCE**
3. Financial / production deploy → **INTELLIGENCE** + human approval flag
4. Send/delete email, publish → approval required
5. Read-only research OK; simple reversible edit may be **COST**
6. COST fail → BALANCED → INTELLIGENCE → **stop**
7. Max **2** escalations; no infinite retry; no same-tier retry unless error says retry can succeed
8. Jev unavailable → **BALANCED** + `degradedRouting: true`

## Clone

```bash
git clone https://github.com/Bodila51/jev-router-for-cursor.git
cd jev-router-for-cursor
cp .env.example .env
# put TYPESAFE_API_KEY (and CURSOR_API_KEY for SDK --run) in .env — never commit it
npm install
npm test
npm run demo
```

## Install

```bash
cd jev-router-for-cursor
cp .env.example .env   # set TYPESAFE_API_KEY; CURSOR_API_KEY for live SDK
npm install
npm test
npm run demo
```

### Cursor Chat plugin (local)

```bash
./scripts/setup.sh
# or: ln -s "$(pwd)" ~/.cursor/plugins/local/jev-router-for-cursor
```

Enable the plugin in Cursor. Set variable `TYPESAFE_API_KEY` (Plugins → Configure) or export it for the MCP process. Restart Cursor if needed.

### MCP only

```bash
npm run mcp
# or: npx tsx mcp/server.ts
```

Tools: `jev_route`, `jev_dry_run`, `jev_status`.

`mcp.json` wires the server for the plugin via `${CURSOR_PLUGIN_ROOT}`.

## Commands (Chat)

| Command | Effect |
| --- | --- |
| `/jev-route` | Route only |
| `/jev-run` | Route then delegate to subagent |
| `/jev-dry-run` | Dry-run routing |
| `/jev-bypass` | Skip Jev this turn |
| `/jev-status` | Config + hard rules |

## SDK runner

```bash
# Dry-run (no CURSOR_API_KEY required for routing path)
npm run dry-run -- "Rename foo to bar in util.ts"

# Route only
npm run route -- "Research TS test runners"

# Status
npx tsx sdk-runner/cli.ts --status

# Live run (needs CURSOR_API_KEY and Node >= 22.13 for @cursor/sdk)
npx tsx sdk-runner/cli.ts --run "Fix the failing auth test"
```

Programmatic:

```ts
import { runRoutedTask } from "./sdk-runner/index.js";

const result = await runRoutedTask({
  facts: { task: "…", repoPresent: true, needsEdit: true },
  dryRun: true,
});
```

### Models

- Prefer **Cursor Router**: `auto-smart` + `optimize_for`: `cost` | `balanced` | `intelligence` when `Cursor.models.list()` shows it.
- If missing: pick real catalog IDs for the three tiers; never invent IDs.
- Offline/static fallback in `config.example.json` documents `composer-2.5` only as a last resort label.

### Cost

`run.usage` / `agent.getUsage()` — if cost is unavailable it is labeled **`unavailable`**. This product never invents dollar amounts.

## Config

See `config.example.json`:

```json
{
  "enabled": true,
  "defaultMode": "balanced",
  "confidenceThreshold": 0.7,
  "maximumEscalations": 2,
  "maximumTaskCostUsd": 1.0,
  "showRoutingTrace": true,
  "logPromptContent": false,
  "requireApprovalFor": ["send_email","delete_data","publish","production_deploy","financial_transaction"]
}
```

Kill switch: `"enabled": false` or `/jev-bypass`.

## Architecture

```
User task
  ├─ Chat: rule → MCP jev_route → subagent jev-{cost|balanced|intelligence}
  └─ SDK:  facts → Jev → policy → model catalog → Agent.create/send → escalate
```

Shared: `shared/config.ts`, `shared/telemetry.ts`, `shared/redaction.ts`  
MCP: `mcp/server.ts`, `mcp/router.ts`, `mcp/policy.ts`, `mcp/typesafe-client.ts`  
SDK: `sdk-runner/*`

## Skills (optional)

- `email-triage` — Jev classify/rank only; no send
- `research-rank` — Jev ranks candidates; Cursor browses/writes

## Testing

```bash
npm test
```

Uses mock TypeSafe client and fixtures (11 product scenarios). No real API keys required in CI.

Chat mode is **soft-enforced** (rule + agents). SDK mode is **hard-enforced** in code.

## Security

See [SECURITY.md](./SECURITY.md). Never commit `.env`. Telemetry redacts secrets; prompts off by default.

## Limitations

- Chat cannot force the parent model ID; it delegates to subagents.
- Live `@cursor/sdk` needs **Node >= 22.13** and `CURSOR_API_KEY`.
- Without `TYPESAFE_API_KEY`, dry-run/demo uses a deterministic mock; live Chat routing should set the key or expect `degradedRouting`.
- Optional Gmail/X are not bundled OAuth apps — skills document the pattern only.

## Uninstall

```bash
rm -f ~/.cursor/plugins/local/jev-router-for-cursor
# remove MCP entry / disable plugin in Cursor
```

## License

MIT — see [LICENSE](./LICENSE).
