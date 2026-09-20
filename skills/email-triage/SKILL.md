---
name: email-triage
description: Classify and rank email triage decisions with Jev (Choice/Score/Noul only). Does not send mail.
---

# email-triage

Use Jev for **classify / rank only**:

1. Gather email metadata (subject, from domain, labels) — not full bodies in telemetry.
2. Ask Jev Choice for folder/priority buckets; Noul for "needs human reply".
3. Never send, delete, or archive without explicit user approval (`requireApprovalFor` includes `send_email` / `delete_data`).
4. Read-only scopes only for any Gmail integration.
