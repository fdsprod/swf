# P4 requirement map

| ID | Required observation | Check |
|---|---|---|
| P4-001 | Explicit opt-in, default one, bounded immutable config and unchanged legacy behavior | Default/legacy/invalid-limit scenarios; config sanity; cumulative P0-P3 |
| P4-002 | Actual failure reaches a fresh process which fixes behavior under original checks | Failing-first fixture, exact captured bytes and digest comparison, fresh thread identities, preserved edits and original checkout |
| P4-003 | Repeated failure stops at repair or total-start limit, with evidence retained | Always-fail limits 0/1/2, immutable repeat config, total limit 1, terminal resume |
| P4-004 | Restart cannot split/reset charges or lose failure context | Both precommit cuts, committed reservation interruption, committed failed verification restart, independent fact replay |
| P4-005 | Decisions retain human authority; continuations consume total starts only | Decision before repair, decision during repair, waiting poll, exact accepted answer context, exhausted total budget |
| P4-006 | Invalid evidence, protected edits and nonrepairable outcomes never enable repair | Manifest/output/contract tamper, protected-tree change, blocked worker, deliberate oracle defects, cumulative verifier restrictions |

The three sanity checks prove schema compatibility, independent replay rejection of invalid budgets/sources/states, and the fixture's refusal to fix from fabricated failure output. The verifier emits unique failure output and checks actual module behavior. The worker fixes only after receiving those captured bytes, a failed result, exit 7, full required-command coverage and preserved first-attempt edits.

P4 has no additional live model dependency: its new behavior is deterministic and inherited live P1/P3 gates remain mandatory. No test may mark a scaffold failure as final accepted-baseline red.
