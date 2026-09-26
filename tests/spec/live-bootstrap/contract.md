# First live factory work: bootstrap CI

The product worker adds only `.github/workflows/bootstrap.yml`. No subagent or
coordinator writes that file. Keep package files, source, and acceptance tests
unchanged. The factory's allowed-path policy independently enforces this scope.

The workflow triggers on every `pull_request` using its default activity types,
with no branch or path filters, and on pushes to `main` only. Use exactly one job:
ID and displayed name `bootstrap-checks`, runner `windows-latest`. Top-level
permissions must be exactly `contents: read`.

Use `actions/checkout@v4` with
`ref: ${{ github.event.pull_request.head.sha || github.sha }}` and
`persist-credentials: false`, then `actions/setup-node@v4` with Node `22.22.3`.
Optional npm caching is permitted. Run these commands in separate unconditional
steps, in order:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npm test`
5. `npm run test:sanity`
6. `npm run check:architecture`

`npm.cmd` is equivalent on Windows. Do not add other actions, jobs, commands,
conditions, environment overrides, permissions, or error suppression. Optional
step names and a job timeout from 1 through 30 minutes are permitted.

## Independent verifier

`verify.mjs` reads the candidate from its current directory. It parses YAML with
the exact external `yaml@2.8.1` library and checks semantic structure. It writes
only stdout, launches no children, and needs no network. Run:

```powershell
node C:/trusted/live-bootstrap/verify.mjs --yaml-root C:/trusted/verifier-deps/node_modules/yaml
```

Use `workflow-structure` as the required local verification spec ID. Pin the
external verifier and every file in the YAML package through `verificationInputs`.
Keep both outside worker-writable paths. The coordinator can copy this verifier
to that external location before pinning it. The factory checks candidate bytes
and refuses changes outside the one allowed file.

Recreate the parser outside the project package:

```powershell
npm.cmd install --prefix .p5-proof/live-operator/verifier-deps --ignore-scripts --no-audit --no-fund --save-exact yaml@2.8.1
$env:BOOTSTRAP_YAML_ROOT = (Resolve-Path .p5-proof/live-operator/verifier-deps/node_modules/yaml).Path
node --test tests/spec/live-bootstrap/sanity.test.mjs
node tests/spec/live-bootstrap/verify.mjs --yaml-root $env:BOOTSTRAP_YAML_ROOT
```

The last command is expected to fail before the worker adds the workflow. Sanity
tests use synthetic in-memory documents; they do not create the product workflow.
The parser lockfile and red/sanity logs are retained under the operator proof
directory. The repository's package files do not gain a YAML dependency.

The local verifier checks workflow structure. It does not claim to execute the npm
commands. The unchanged product baseline already has its independent cumulative
gate. Actual GitHub Actions must execute the six commands on the delivered head;
the factory must observe `bootstrap-checks` from GitHub Actions app ID `15368`
for that exact SHA before reporting CI success. This live observation is required.

## Trigger evidence and limits

GitHub documents that workflow selection uses the event's associated commit or
ref. For `pull_request`, that ref is the merge branch. A new workflow included in
a mergeable pull request can therefore trigger before it exists on `main`; this
is an inference from the documented rules, not a live observation of this repo.
The explicit checkout expression selects the delivered PR head for the commands,
and the triggering SHA for a push to main.

Sources: [workflow selection](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows#workflow-triggers),
[pull request events and checkout ref](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request),
[YAML parser API](https://eemeli.org/yaml/).

Repository Actions settings, token authority, and mergeability still affect the
live run. No live pass is claimed by these files. Issue creation, workflow
implementation, branch push, PR creation, and CI observation remain separate
coordinator/factory actions.
