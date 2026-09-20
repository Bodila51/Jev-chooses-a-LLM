# SDK smoke results (sanitized)

Live runs on one developer machine (Windows, Node 25, no `auto-smart` on the account).

| Scenario | Jev tier | Model used | Notes |
| --- | --- | --- | --- |
| Rename button | COST | composer-2.5 | Full Agent.create |
| README bullets | COST | composer-2.5 | Jev chose cost |
| Security review | INTELLIGENCE | claude-opus-5 | Wrote SECURITY-HARDENING.md |
| X research top posts | BALANCED | claude-sonnet-5 | ~2 min, finished |
| Prod deploy prompt | INTELLIGENCE | claude-opus-5 | Stopped for human approval |
| Financial prompt | INTELLIGENCE | claude-opus-5 | Stopped for human approval |

Honest limits:

- Cursor Chat soft-routing does **not** hot-swap the parent model.
- SDK `--run` sets the model before execution.
- Dollar cost may be `unavailable` depending on plan metering.
