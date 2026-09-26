# Inspect requirement map

| ID | Requirement | Backpressure observation |
|---|---|---|
| P6-I001 | One identified persisted snapshot and useful human output | Local verified fixture, exact JSON schema/replay comparison, concise labeled human view, repeated read |
| P6-I002 | Immutable total/repair budgets from reservations | Live reserved attempt, interruption/retry, human continuation during repair, explicit exhaustion, disabled legacy repair |
| P6-I003 | Decisions, evidence, delivery and CI remain separate | Human wait/resolution, pending and failed CI with local VERIFIED, durable push intent, artifact references |
| P6-I004 | Inspection is read-only under an active owner | Stable history/projection/worktrees/artifacts/invocations/gateway captures; fake remote changed but not polled; allowed candidate edits remain untouched |
| P6-I005 | Current and historical integrity errors cannot appear healthy | Missing manifest, changed command output, older failed repair manifest, superseded CI observation, corrupt projection |
| P6-I006 | Explicit CLI errors without store creation | Missing store, absent/repeated/unknown arguments, exact error codes/exits |

Three sanity checks challenge the independent oracle with wrong counters/sequence/verification, invalid feature combinations, and misleading human output. The 16 scenarios are feature-specific checks. They do not substitute for two real self-hosted issues, actual human authority, bounded repair or protected-check proof.
