# Security Policy — Jev Router for Cursor

## Data destinations

| System | What is sent | Purpose |
| --- | --- | --- |
| **TypeSafe** (`api.typesafe.ai`) | Task state + typed Choice/Score/Noul questions | Routing decisions only. Jev does not browse, write prose, edit files, or operate accounts. |
| **Cursor** (IDE / `@cursor/sdk`) | Prompts, workspace context, tool calls | Execution after a route is chosen. |

Never commit `.env`. Rotate keys if leaked.

## Redaction & telemetry

- Default: **do not log raw prompts** (`logPromptContent: false`).
- Telemetry stores a length + fingerprint digest, not full task text.
- Secrets (API keys, JWTs, emails, Bearer tokens) are redacted before any optional prompt logging.
- Full email bodies must not be written to telemetry.

## Approvals

Config `requireApprovalFor` defaults include:

- `send_email`
- `delete_data`
- `publish`
- `production_deploy`
- `financial_transaction`

Chat mode: parent must ask the user before side effects.  
SDK mode: runner stops with `cancelled` when approval is required (unless dry-run).

## Email integrations (optional)

If you wire Gmail/X later, use **read-only** scopes for triage. Sending requires explicit approval.

## Model IDs

Never invent Cursor model IDs. Discover via `Cursor.models.list()`. Prefer `auto-smart` + `optimize_for`. Static fallbacks in config are documented offline defaults only (`composer-2.5`).

## Kill switch

- Set `"enabled": false` in config, or
- Use `/jev-bypass` / include `bypass jev` in the task.

## Reporting

Report vulnerabilities privately to the maintainers. Do not file public issues with live secrets.
