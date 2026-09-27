# Configurable worker skills

This feature assigns instructions to the existing single worker. It adds no agent scheduler. With `skills` absent, the current config, prompts, result protocol, and recovery behavior remain unchanged.

## Configuration

`LocalConfig.skills` is optional. GitHub runs use the same field at `runtime.skills`.

```ts
type Assignment =
  | { role: "tester" | "designer" }
  | { role: "implementation"; design: { kind: "none" } | { kind: "provided"; path: string } };
interface Skills {
  assignment: Assignment;
  catalog: { id: string; root: string; entrypoint: string; assets: string[] }[];
  common: string[];
  byRole: { tester: string[]; designer: string[]; implementation: string[] };
}
```

All objects reject unknown fields. Catalog IDs are nonempty and unique. Every listed ID must exist. `common` is nonempty and contains `ste`. Role lists may be empty. Duplicate references in lists are allowed. Selection concatenates common, assigned role, then designer only for implementation with `design.kind === "none"`. It removes duplicate IDs in first-occurrence order. Catalog order does not determine prompt order.

The editable example selects STE for all roles, TDD for testers, and data-structure-design plus tracer-bullets for designers. Implementation without a provided design inherits designer skills. Operators may change paths, add common skills, and replace role lists. They must retain a common `ste` entry. No installed user path is a hidden default. No source file is bundled merely because it is named in a Markdown link.

## Trusted files

Roots and provided-design paths are absolute. Entry and asset paths are normalized relative file paths inside their declared root. Reject absolute relative paths, empty components, dot components, parent traversal, and filesystem links in selected paths or their ancestors. Selected files must be regular files. Reject selected files within `repositoryPath`, `workspaceRoot`, `artifactRoot`, or a `blockedReadPaths` target, before reading their contents. Treat path comparisons with the platform's filesystem case rules. Root itself is only a containment boundary. Do not crawl it.

Selected entrypoints, declared assets, and provided design join the existing `contract.programs` artifact list. Pin canonical original paths and SHA-256 bytes. Do not copy files into a new snapshot system. Unselected and undeclared files are not pinned. Revalidate all selected original files before every worker prompt, including retry, repair, and decision continuation. Missing, replaced, linked, or changed pinned files produce `artifact_invalid` before another worker starts. Existing durable config equality applies to the full skill config. Changed assignment, lists, or paths produce `config_mismatch`.

Entry and provided-design files must contain valid UTF-8 text, from 1 through 65,536 bytes each. The sum of selected entry text and provided-design text is at most 262,144 bytes. Declared assets may contain arbitrary bytes and are referenced by readable paths. The cap excludes unselected files and asset bytes. Worker access permits selected-file reads and denies writes. Skill inputs do not expand writable roots or expose blocked files.

## Prompt

For a plain worker prompt, add `instructions` to the existing JSON prompt object. For the existing structured decision or repair input, add `context.instructions`. Do not change the worker response protocol because skills are enabled.

```ts
type Artifact = { path: string; digest: string };
type Instructions = {
  assignment:
    | { role: "tester" | "designer" }
    | { role: "implementation"; design: { kind: "none" } | { kind: "provided"; artifact: Artifact; text: string } };
  skills: { id: string; entrypoint: Artifact; text: string; assets: Artifact[] }[];
};
```

Deliver exact decoded text, with original newlines and a leading UTF-8 BOM preserved as U+FEFF, and exact selected order. Entry and asset identities must equal the pinned artifacts. Provided design contains its exact text and pinned artifact. Each canonical file has one program pin even when several selected IDs reference it. Each fresh process gets the same role and selected instructions. Existing attempt-specific decision and repair context remains authoritative. Supplying skills does not authorize changes to independent tests or other protected files.

## Errors and proof

Malformed config, unsafe initial paths, missing initial files, invalid UTF-8, and size violations fail before worker dispatch as the existing input error (local `input_error`, durable `durable_error` with code `input_error`, exit 2). Changed pinned files after run creation fail as `artifact_invalid`, exit 1. The feature has no new result or lifecycle tag.

Independent tests capture the actual process prompt, compare exact text and hashes, exercise filesystem read/write restrictions, and check selected pins. They also cover local, durable, decision, repair, and GitHub entry paths. Recovery tests mutate files between durable creation or completed work and the next prompt. Existing phase tests remain frozen. These checks prove instruction delivery and input integrity, not whether a model follows every sentence.

The assignment union makes design presence explicit. Existing artifact pins remain the single source of file identity. Role selection and worker lifecycle remain separate concerns. A future role must extend the closed role lists and schema before it can run.
