# Worker skills

Skills add trusted instructions to the existing single worker. They do not add a scheduler or change its response protocol. If `skills` is absent, config, prompts, and recovery retain their existing behavior.

## Configure instructions

1. Copy [the example skills object](../examples/agent-skills.json) into `LocalConfig.skills` or GitHub `runtime.skills`.
2. Change each catalog root to an absolute path on the host. The example paths are placeholders, not defaults. The factory does not discover installed skills or ambient configuration.
3. Set the assignment to `tester`, `designer`, or `implementation`.
4. For implementation, set `design` to `{ "kind": "none" }` or `{ "kind": "provided", "path": "C:/factory-instructions/design.md" }`.
5. Add each required asset to its catalog entry. Use `assets: []` for a self-contained entrypoint.

The example applies STE to every role, TDD to testers, and data-structure-design plus tracer-bullets to designers. You can change paths, add common skills, and replace role lists. Keep `ste` in `common` and in the catalog. All list IDs must exist in the catalog. Catalog IDs must be unique. Unknown fields are errors.

Selection reads `common`, then the assigned role list. Implementation with `design.kind: "none"` also gets the designer list. A provided design disables that inheritance. Duplicate references are removed in first-occurrence order. Catalog order does not control prompt order. Role lists may be empty.

## Files and access

Roots and provided-design paths must be absolute. Entrypoints and assets use relative file paths with `/` separators. Empty components, `.`, `..`, absolute paths, and filesystem links in selected paths or their ancestors are invalid. Selected inputs must be regular files outside the repository, workspace root, artifact root, and blocked read paths.

The factory reads only selected entrypoints, declared assets, and a provided design. It does not crawl skill roots or follow Markdown links to add files. Entrypoints and designs must be valid UTF-8 text from 1 through 65,536 bytes each. Their combined selected text must not exceed 262,144 bytes. Assets may contain arbitrary bytes and do not count toward the text cap.

The worker gets exact decoded text, including original newlines and a leading BOM. Assets are referenced by readable paths. Selected files are read-only. Skills do not expand writable roots or permit edits to protected files or independent tests.

## Pins and recovery

Selected files join `contract.programs` with canonical original paths and SHA-256 digests. Each canonical file has one pin, even when multiple skill IDs reference it. There is no separate snapshot lifecycle. Unselected and undeclared files are not pinned as skill inputs.

The factory revalidates selected files before each worker prompt, including retries, repair, and decision continuation. Changed or missing pinned inputs stop dispatch with `artifact_invalid` and exit 1. Changing the durable assignment, catalog, or lists produces `config_mismatch`. Invalid initial config, paths, text, or size limits produce `input_error` and exit 2.

Plain prompts carry `instructions`. Decision and repair prompts carry `context.instructions`. Each fresh process gets the same assignment and selected instructions. Existing attempt-specific decision and repair context remains authoritative.

The independent acceptance suite checks actual process prompts, text, hashes, permissions, pins, and recovery. These checks prove instruction delivery and file integrity. They do not prove that a model follows every instruction. Typechecking alone does not establish behavioral acceptance.
