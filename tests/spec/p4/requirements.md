# P4 requirement map

| ID | Required observation | Check |
|---|---|---|
| P4-001 | Explicit opt-in, default one, bounded immutable config and unchanged legacy behavior | Default/legacy/invalid-limit scenarios; config sanity; cumulative P0-P3 |
| P4-002 | Actual failure reaches a fresh process which fixes behavior under original checks | Mixed failed/passed required commands, exact captured binary bytes and digests including invalid UTF-8, fresh thread identities, preserved edits and original checkout |
| P4-003 | Repeated failure stops at repair or total-start limit, with evidence retained | Always-fail limits 0/1/2, immutable repeat config, total limit 1, terminal resume |
| P4-004 | Restart cannot split/reset charges or lose failure context | Both precommit cuts, committed reservation interruption, actual dispatched repair with partial edit and live worker, committed failed verification restart, independent fact replay |
| P4-005 | Decisions retain human authority; continuations consume total starts only | Decision before repair, decision during repair, waiting poll, exact accepted answer context, exhausted total budget |
| P4-006 | Invalid evidence, protected edits and nonrepairable outcomes never enable repair | Current and historical failed manifest/output tamper, allowed candidate changed after reservation but before initial repair dispatch, contract tamper, protected-tree change, blocked worker, actual verifier timeout, deliberate oracle defects, cumulative verifier restrictions |

The four sanity checks prove schema compatibility, independent replay rejection of invalid budgets/sources/states, context binding to the latest applicable repair, and the fixture's refusal to fix from fabricated failure output. The verifier emits unique failure output and checks actual module behavior. The worker fixes only after receiving those captured bytes, a failed result, exit 7, full required-command coverage and preserved first-attempt edits. The two-repair scenario requires the second repair to receive the second measured failure, not the first failure again.

P4 has no additional live model dependency: its new behavior is deterministic and inherited live P1/P3 gates remain mandatory. No test may mark a scaffold failure as final accepted-baseline red.
