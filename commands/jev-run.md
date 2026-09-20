---
name: jev-run
description: Route with Jev then delegate to the selected jev-* subagent
---

1. Call MCP `jev_route` with the user task.
2. If `requireApproval`, ask the user first.
3. Delegate the main task to `subagent` (`jev-cost` | `jev-balanced` | `jev-intelligence`).
4. Return the subagent result. Do not redo the main work in the parent.
