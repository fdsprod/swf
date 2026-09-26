# P1 runtime learning findings

Observed on Windows, 2026-09-25 local time (2026-09-26 UTC). Node was `v22.22.3`; Codex was `codex-cli 0.157.1`. These probes test external dependencies before product implementation. They are retained as documentation in `tests/learning/p1/`, outside the acceptance suite. They do not establish P1 acceptance.

## Invocation and protocol

The installed npm shim is `C:/nvm4w/nodejs/codex.cmd`. Probes invoke its installed native binary directly, with argument arrays:

`C:/nvm4w/nodejs/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`

The shim passes through cmd.exe. An exploratory invocation through that shim stripped TOML quotes and failed to parse the permissions table. Native argv preserved them. Production must resolve its configured executable rather than assume this machine's path.

The successful live invocation used the following argument sequence. Each line after `-c` is one argument, with `<...>` replaced by absolute paths. The prompt was sent on stdin.

```text
--no-daemon --ask-for-approval never exec --ignore-user-config
-c windows.sandbox="elevated"
-c default_permissions="p1"
-c permissions.p1.filesystem={":root"="read", ":workspace_roots"="write", "<shared-git-directory>"="read"}
-c permissions.p1.network.enabled=false
--ephemeral --cd <worktree> --json --color never
--output-schema <protected-schema-file>
--output-last-message <protected-final-file> -
```

No `--sandbox workspace-write` override is present: the named profile defines the boundary. No additional writable roots, approval escalation, or sandbox bypass was used. Rules remained enabled in the final probe. The first unsuccessful probe included `--ignore-rules`; it completed before the coordinator's instruction to retain rules arrived. That probe is not boundary evidence.

`codex-smoke.mjs` supplied a closed root object schema with required `outcome`, `sourceEdited`, and `externalWriteDenied` properties. Codex wrote the final JSON into the external output file and also emitted it as an `item.completed` item with `item.type="agent_message"`. Earlier agent messages contained ordinary prose. Therefore, every agent-message event is not a final structured result.

Observed JSONL event types were `thread.started`, `turn.started`, `item.started`, `item.completed`, and `turn.completed`. Command items used `type="command_execution"`, `aggregated_output`, `exit_code`, and `status`. A denied command had exit code 1 and status `failed`; the overall CLI still exited 0 after reporting the requested observation. Earlier probes returned a valid `blocked` final outcome with overall exit code 0. Process success is not agent completion or verification success.

Only a closed flat response schema was tested. The P0 canonical outcome union and arbitrary evidence metadata were not tested against structured output. Use a small closed wire format and validate/translate it into domain outcomes. A wrapper containing a nested union needs its own proof if selected. Preserve stdout and stderr separately, bound their size, and reject missing or malformed final data.

## Filesystem restrictions

`sandbox-probe.mjs` runs a deterministic Node fixture using the installed native sandbox, without a model call:

```text
sandbox -P p1
-c permissions.p1.filesystem={":root"="read", ":workspace_roots"="write", "<worktree>/tests"="read", "<shared-git-directory>"="read", "<fake-credential-file>"="deny"}
-c permissions.p1.network.enabled=false
-C <worktree> -- <node-executable> <probe-script>
```

On this version the Windows command is `codex sandbox`, with no `windows` subcommand. A named profile is required. Node under the nvm installation failed with `CreateProcessAsUserW` error 5. Resolving the nvm symlink did not fix it. Copying the same Node executable into the disposable fixture let the sandbox execute it, without changing policy or ACLs. Both a copy inside the worktree and a copy in the external fixture root worked; the external copy avoids adding the binary to the target tree. System Windows PowerShell also executed; `Set-Content` worked, while arbitrary .NET method calls were rejected by constrained language mode.

The final direct probe observed:

| Operation | Result |
|---|---|
| Write ordinary worktree source | Succeeded |
| Write sibling external artifact sentinel | `EPERM`; original content retained |
| Write protected `tests/` sentinel inside worktree | `EPERM`; original content retained |
| Write shared Git directory sentinel | `EPERM`; original content retained |
| Read dummy credential file with `deny` rule | `EPERM` |

A real Git worktree contains a `.git` file pointing into the main repository's `.git/worktrees/...`. It does not have independent Git authority. Protect both the worktree Git pointer and the actual common Git directory in the product policy. The probe tested writes to the common directory, not replacement of the pointer.

The first live calls with ignored user config and legacy `workspace-write` blocked both shell writes at tool policy. Explicit `windows.sandbox="elevated"` made execution usable. With legacy `workspace-write`, both the source and external sentinel under the user temp directory were writable. This was a failed boundary test. The restrictive named profile fixed it: the live model wrote `source.txt`, received an OS access-denied error for the external sentinel, and reported both observations in structured output.

The broad `:root="read"` rule still allows reads except where denied. Production must scrub delivery credentials from subprocess environments, deny configured sensitive file roots, and prevent implicit connector authority. These probes used only dummy credentials; they did not inspect real credentials. They did not test a real network connection, push attempt, all connector configurations, or every credential provider. The scope is an approved local project, not hostile multi-tenant execution.

## Process lifetime

`process-lifetime.mjs` compared two external Windows behaviors. Its worker parent exited successfully after starting a detached grandchild.

- `taskkill /PID <exited-parent> /T /F` returned 128 because the parent no longer existed. The owned grandchild survived. The probe then terminated that exact recorded grandchild PID.
- `job-probe.ps1` used `CreateProcessW` with `CREATE_SUSPENDED`, assigned the child to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then resumed it. After the parent exited, closing the Job handle terminated the detached grandchild. No owned grandchild remained.

Use Job ownership before resuming the worker. Do not enable breakaway or allow child processes to inherit the Job handle. A production supervisor must also bind its lifetime to the factory owner, report containment failures, and confirm all owned processes have stopped before verification. The probe covers detached descendant cleanup after normal parent exit; it does not prove the product supervisor, factory crash recovery, or timeout handling. The live smoke's emergency taskkill timeout is only a bounded research fallback and is not the production containment design.

## Evidence and reproduction

All evidence roots below are under `C:/Users/fdspr/AppData/Local/Temp/`. Each contains `result.json`, directly or under `protected/`. Live roots also contain separate stdout JSONL, stderr, final output, and schema files.

| Root | Observation |
|---|---|
| `swf-p1-learning-a6YG2l` | First live call; both writes rejected before execution; rules ignored; unusable boundary proof |
| `swf-p1-learning-VsyboA` | Rules retained; both writes rejected before execution |
| `swf-p1-learning-rAr4l4` | Explicit elevated sandbox plus legacy workspace-write; source and temp sentinel both changed; boundary failed |
| `swf-p1-learning-z06ydF` | Named profile; source changed; external sentinel denied; live smoke passed |
| `swf-p1-sandbox-0ckVnp` | Final deterministic source, external artifact, protected tests, shared Git, and dummy credential proof passed |
| `swf-p1-sandbox-M6DR7Q` | Same boundary checks passed with copied Node executable outside the worktree |
| `swf-p1-process-TKESWt` | Taskkill limitation and Job cleanup proof passed |

Run from the repository root:

```powershell
# No model call. Copies Node only into its disposable fixture.
$env:P1_COPY_NODE = '1'
$env:P1_NODE_OUTSIDE = '1'
node tests/learning/p1/sandbox-probe.mjs
Remove-Item Env:P1_COPY_NODE
Remove-Item Env:P1_NODE_OUTSIDE

# No model call. Starts and cleans up only its owned descendants.
node tests/learning/p1/process-lifetime.mjs

# One live model call, bounded to 180 seconds.
node tests/learning/p1/codex-smoke.mjs
```

Fixtures are deliberately retained for inspection. Before deleting any fixture recursively, resolve its absolute path and verify that it is the exact named probe directory under the intended temp root. Never delete by a broad prefix or wildcard.

## Primary references

The local installed help was checked first. Official documentation describes the Windows sandbox modes and named permission profiles: [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). These explain the controls; the observations above establish behavior on this machine.

Microsoft documents descendant inheritance and kill-on-close semantics in [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and [Job limit flags](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information).
