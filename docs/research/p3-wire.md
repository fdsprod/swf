# P3 nested decision wire learning

The installed `codex-cli 0.157.1` accepted a strict root object containing a nested `anyOf` outcome. Two live calls returned the requested decision and completed branches, respectively. Both exited 0 and passed independent Ajv validation. This is external runtime learning, not P3 product acceptance.

The probe ran on Windows with Node `v22.22.3` on 2026-09-25 local time, 2026-09-26 UTC. It created a disposable directory, asked only for synthetic JSON responses, and made no repository edits or remote writes. Neither call emitted a command-execution item. The disposable workspace remained empty. The calls used model inference, but no issue, comment, branch, or PR was created.

## Tested shape

The root is an object with required `outcome` and `additionalProperties:false`. Its `outcome` property has two nested `anyOf` branches:

```ts
type WorkerWire = {
  outcome:
    | { kind: "completed" | "blocked" | "failed"; message: string }
    | {
        kind: "decision_required";
        decision: {
          question: string;
          reason: string;
          options: {
            id: string;
            description: string;
            consequences: string[];
          }[];
          impact: string[];
          reversible: boolean;
        };
      };
};
```

All objects are closed and all displayed fields are required. The decision discriminator uses JSON Schema `const`. The completed/blocked/failed discriminator uses `enum`. The schema imposes no minimum array length. It uses ordinary string types; product semantic validation must still reject empty required text.

Canonical P0 `DecisionRequest` uses `impact:string[]` and option `consequences:string[]`. The probe preserves those arrays. It makes `options` required on the wire, although the canonical field is optional. Factory code supplies `id`, `runId`, `unitId`, and `evidence`; these authority-bearing fields are absent from the worker schema.

The tested schema digest is SHA-256 `f1af7887ede9407a4696c3fc728c4b6854de48d487206ab52c163806ca6ea87b`.

## Observations

| Case | Observed result |
|---|---|
| Decision | Exit 0; exact requested `decision_required` object, two options, array consequences and impact, `reversible:true`; schema valid |
| Completed | Exit 0; exact `{outcome:{kind:"completed",message:"Synthetic probe completed without actions."}}`; schema valid |
| Both streams | `thread.started`, `turn.started`, one completed agent-message item, `turn.completed`; no tool commands |
| Filesystem | Workspace stayed empty; host wrote only retained probe artifacts |

The decision response asked which color a synthetic preview should use. Its options were `blue` and `green`, each with one descriptive consequence. The final output file matched the final JSONL agent-message text in both calls. No schema rejection occurred.

This proves the displayed nested schema works on this installed version. It does not prove every nested union or every future model/version, does not exercise decision persistence or authority, and does not test blocked/failed branch selection. The existing P1 evidence separately covers flat blocked/failed outcomes. Empty options and malformed responses remain acceptance-test concerns.

## Invocation and reproduction

The script [codex-decision-wire.mjs](../../tests/learning/p3/codex-decision-wire.mjs) uses the native executable from the accepted P1 deployment. Arguments are passed as an array, so no shell strips the TOML quotes.

```text
--no-daemon --ask-for-approval never exec --ignore-user-config
-c windows.sandbox="elevated"
-c default_permissions="p3wire"
-c permissions.p3wire.filesystem={":root"="read", ":workspace_roots"="write"}
-c permissions.p3wire.network.enabled=false
-c mcp_servers={}
--ephemeral --skip-git-repo-check --cd <empty-workspace>
--json --color never --output-schema <schema-file>
--output-last-message <final-file> -
```

The prompt arrives on stdin. `--skip-git-repo-check` permits the empty disposable directory; it does not bypass sandbox restrictions. No global config, trust entries, rules, ACLs, or permissions were changed. There was no additional writable root or sandbox fallback.

Reproduce with:

```powershell
& 'C:/nvm4w/nodejs/node.exe' tests/learning/p3/codex-decision-wire.mjs
```

The script makes two model calls with a 180-second limit per call. Its emergency timeout cleanup targets its still-running child process. That research fallback does not claim the production Job Object lifetime guarantee.

Evidence is retained at `C:/Users/fdspr/AppData/Local/Temp/swf-p3-wire-JUshTB`. The root `result.json` records runtime versions, the executable, the schema digest, arguments, exits, and assertions. `artifacts/wire.schema.json` holds the exact schema. Each case directory contains the prompt, stdout JSONL, stderr, final response, and case result. No credentials are copied into these artifacts.

Official OpenAI documentation requires an object root for structured output and permits supported `anyOf` schemas below that root. The local probe establishes this specific schema's actual behavior. See [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and Codex's [noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
