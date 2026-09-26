# P5 controlled Git directory with shared objects

Observed on 2026-09-26 with Git 2.51.0.windows.2 and Node 22.22.3 on Windows. Keep [the isolated probe](../../tests/learning/p5/shared-objects-probe.mjs) as dependency documentation. It imports no product code and uses only disposable local repositories, owned sentinel programs and local bare remotes. No credentials, network requests or user Git configuration changes are involved.

```powershell
node tests/learning/p5/shared-objects-probe.mjs
```

An optional first argument selects the report path. The final run passed 49 Git commands and retained `C:/Users/fdspr/AppData/Local/Temp/swf-p5-shared-objects-ntpc25/observations.json`. The report includes exact command arguments, explicit environment additions, input bytes, outputs, tree records and source snapshots.

## Tested mechanism

The probe resolves the source common Git directory with `rev-parse --path-format=absolute --git-common-dir` and canonicalizes its `objects` path. It creates a separate empty bare Git directory, a private staging directory and a private index. Each controlled command supplies:

```text
git --git-dir=<controlled bare directory> --work-tree=<private staging>
GIT_INDEX_FILE=<private index>
GIT_OBJECT_DIRECTORY=<canonical source common-Git objects>
```

Inherited `GIT_*` settings are removed. System config and attributes are disabled, global config and global attributes point to an empty file, hooks point to an empty directory, the credential helper list is empty, and autocrlf, filemode and signing are disabled. Author/committer identities and dates are fixed for the commit operation.

The controlled directory could not read the base commit without the object override. With it, the following sequence succeeded:

1. `read-tree <base>` initialized the private index from the pinned base.
2. `--attr-source=<base> add -A -f --pathspec-from-file=<file> --pathspec-file-nul` staged an explicit NUL-separated path list.
3. `write-tree` produced the exact candidate file set.
4. `commit-tree <tree> -p <base> -F -` produced the same commit twice from identical message/identity/date inputs.
5. `--attr-source=<commit> cat-file --filters <commit>:<path>` matched every private candidate file byte-for-byte.
6. An explicit empty expected-ref lease pushed that SHA to the intended local bare remote. Repeating the push preserved the same ref. Exact-ref `ls-remote` returned the planned SHA.

The resulting commit was `df3936c247d1ecb635bbbd58fd243cae8b8c88d9`, with exactly one commit after parent `a47c37d85d129b5d6fa2c762d9a7671903151fde`. A fresh read of the remote without the shared-object environment found the complete tree and matching checkout bytes, so the receiver did not depend on the sender's object override.

This is consistent with Git's documented independent [object, index, repository and work-tree path controls](https://git-scm.com/docs/git#_environment_variables). Shared object additions are intentional; source references and the ordinary source index are separate inputs.

## Representation and isolation observations

The base executable remained mode `100755`. A new filename containing a space received `100644`. An explicitly listed deleted path was absent. Standard `*.txt text eol=crlf` attributes stored LF text blobs and produced the original CRLF candidate bytes on filtered read. The attributes file itself was unchanged.

Before the controlled sequence, positive controls proved that the source repository's configured pre-push hook, credential helper and custom smudge filter executed their owned sentinel programs. Source `.git/info/attributes` selected that filter. A configured URL rewrite made a read of the nominal intended remote return a distinct decoy ref.

During the controlled sequence, no further source sentinel calls occurred. Filtered output retained the candidate's lowercase bytes instead of the source filter's uppercase transformation. The actual intended remote received the commit; the decoy did not receive its delivery ref. The controlled configuration listing excluded the source filter, hook and rewrite settings.

Source HEAD value/bytes, ordinary index bytes, config, info attributes and tracked working-file snapshots stayed identical. The new blob/tree/commit objects were added to the shared object database. The probe does not claim that every internal Git metadata file stayed unchanged.

## Scope

These observations support the proposed controlled-directory mechanism on the installed Windows Git version. They do not relax P5's existing unsupported-representation policy, authorize copying unverified paths, or replace candidate/evidence validation. The tested source is an ordinary repository; the common-directory query is explicit, but linked-worktree discovery is not separately exercised here.

There was no concurrent source object deletion, object corruption, alternate object database, custom object format, symlink/submodule, worker access to the private staging directory, or live HTTPS push. Local create-only conflict behavior remains documented by the earlier Git probe. Real credentials, GitHub permissions and branch protection still require the mandatory live proof.
