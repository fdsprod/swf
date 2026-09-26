# P5 Git delivery learning

Observed on 2026-09-26 with Git 2.51.0.windows.2 and Node 22.22.3 on Windows. This research uses disposable local repositories and one bare remote. It imports no factory code, changes no product or acceptance files, and performs no network operations.

Keep [the probe](../../tests/learning/p5/git-delivery-probe.mjs) as dependency documentation. It is outside the product test suite. Run it with:

```powershell
node tests/learning/p5/git-delivery-probe.mjs
```

An optional first argument selects the JSON evidence path. By default, the report and all fixtures remain in a new temporary directory. The successful final run used `C:/Users/fdspr/AppData/Local/Temp/swf-p5-git-learning-E2D4RM/observations.json`. It recorded 106 Git invocations, their arguments, explicit environment overrides, input, exit status, stdout, and stderr. The script also records candidate hashes, trees, commits, and remote observations.

## Candidate tree and preservation

The fixture has a linked worktree with an ordinary index that deliberately differs from its working files. An alternate index starts from the pinned base:

```text
GIT_INDEX_FILE=<temporary index>
git read-tree <base>
git --attr-source=<base> add -A -f --pathspec-from-file=<NUL file> --pathspec-file-nul
git write-tree
```

The explicit path list included modified tracked files, a deleted tracked file, a new filename with a space, and an allowed new file that matched `.gitignore`. The resulting tree included both new files and excluded the deletion. Unlisted ignored and untracked files were absent. `-f` permitted the explicitly listed ignored file. This observation does not establish how the factory should choose allowed paths.

The base executable mode `100755` survived staging on Windows with `core.filemode=false`. A new file received `100644`. `update-index --chmod=+x` changed a second file to `100755` in the alternate index. This proves an explicit index mode operation. It does not prove that Windows filesystem permissions identify executable changes.

The source repository and linked worktree retained identical file hashes, ordinary index bytes, and HEAD commits before and after candidate construction, commit creation, and push. Git added objects to the shared object database. The probe does not claim that all internal Git metadata stayed unchanged.

## Attributes and expected checkout bytes

The base attributes selected `*.txt text eol=crlf`. With `core.autocrlf=false`, pinned-base staging still stored LF blobs. Unpinned staging after changing the worktree attributes to `*.txt -text` instead stored CRLF blobs. `core.autocrlf=false` does not disable explicit attributes.

A separate roundtrip fixture compared each candidate file hash with the produced commit's filtered representation:

```text
git -c core.autocrlf=false --attr-source=<produced commit> cat-file --filters <produced commit>:<path>
```

| Fixture | Observed comparison |
| --- | --- |
| Unchanged `text eol=crlf` attributes | All candidate files matched, including the new CRLF file. |
| Candidate changes attributes to `-text`, staging still pins base attributes | The attribute file matched. Both candidate text files differed: candidate bytes were CRLF, produced commit's filtered bytes were LF. |
| Configured uppercase clean filter and passthrough smudge filter | Candidate was lowercase CRLF. Produced commit's filtered representation was uppercase CRLF. |

Thus a base-pinned clean operation alone does not establish that the result represents the verified checkout. The command above exposed the tested differences. It depends on the same checkout configuration and filter programs. It does not prove a future checkout under different configuration will match.

Repository `.git/info/attributes` still overrode `--attr-source=<base>` in the probe. Pinning an attribute tree does not isolate other attribute sources. A comparison with the produced commit also operates under repository info attributes and global/system attributes unless those inputs are fixed or excluded. The probe used empty global attributes and disabled system attributes. Matching this local representation is not proof about a remote checkout with different attributes or filter configuration.

## Deterministic commit objects

The probe supplied a tree, one parent, exact message bytes, author identity/date, and committer identity/date to `commit-tree`. Signing was disabled. Repeating the command after discarding its first result produced the same commit:

```text
git commit-tree <tree> -p <base> -F -
c844ff593af33b0166edaca58db1ff663582248b
```

Both author and committer dates were `1700000000 +0000`. Changing only the committer date changed the SHA to `84b5ea574e18e1cd6e73527bfc48c11543e3d1dc`. Exact tree and parent alone do not fix commit identity. `commit-tree` did not advance HEAD or invoke the configured `pre-commit` and `commit-msg` hooks.

## Push observations and identity limits

The probe pushed an explicit SHA to `refs/heads/swf/p5-learning`, ignored that command's response as a receipt, and queried the bare remote:

```text
git push --porcelain <bare remote> <commit>:refs/heads/swf/p5-learning
git ls-remote --exit-code <bare remote> refs/heads/swf/p5-learning
```

`ls-remote` returned the exact commit and full ref. Repeating the same non-force push exited 0 and reported `up to date`. The remote ref stayed unchanged. No second commit sequence was needed. This simulates a lost receipt, not a transport interruption during a push.

A separate branch contained the other commit with the same parent. `ls-remote` exposed the different SHA. Pushing the intended commit without force failed and retained the remote commit. A missing exact ref returned status 2.

A different SHA is not always protected by ordinary push rejection. When a branch contained the intended commit's ancestor, a non-force push advanced it successfully. Exact-SHA conflict detection and Git's fast-forward policy are distinct. An absence query followed by plain push does not provide compare-and-create protection.

## Empty expected-ref lease

A separate case used an explicit empty expected ref:

```text
git push --porcelain --force-with-lease=refs/heads/swf/create-only: <bare remote> <commit>:refs/heads/swf/create-only
```

Despite the option name, the tested policy was creation without overwriting an existing differing branch. It did not use a `+` refspec or an unconditional force option.

| Remote state at push | Observed result |
| --- | --- |
| Ref absent | Exit 0. Ref created at the intended commit. |
| Ref already equals intended commit | Exit 0, `up to date`. Ref unchanged. |
| Ref created by another writer at an ancestor after the absence query | Exit 1, `stale info`. Ancestor ref unchanged. |

The last fixture explicitly interleaved an absence read, another branch creation, and the leased push. The ordinary-push control accepted that ancestor fast-forward. The empty lease rejected it. This establishes the tested create-only behavior on the local bare transport. It is not a live GitHub concurrency or branch-protection proof.

## Git configuration, hooks, and filters

The probe removed inherited `GIT_*` settings, disabled system Git configuration and system attributes, and supplied empty global configuration and global attributes files. These changes apply only to child processes. It did not modify the user's Git settings. Repository configuration remained active so its effects could be observed.

The fixture's configured `pre-push` hook wrote a local sentinel during a control push. Supplying `-c core.hooksPath=<empty directory>` suppressed that local hook on the repeated push. This does not establish remote hook behavior or disable filter drivers.

A configured clean filter still ran under pinned attributes and disabled hooks. The observed `add` invoked it twice. The probe requires at least one invocation rather than treating the exact count as a stable API. With `filter.learning.required=true` and no smudge command, `cat-file --filters` failed with status 128. Configuring a passthrough smudge command let the checkout comparison run and expose the uppercase discrepancy.

These observations apply to approved local repositories. Local config, info attributes, and filter programs remain inputs to Git behavior. The probe does not establish filter determinism, remote GitHub permissions or branch protection, credential behavior, simultaneous live-server races, arbitrary path handling, symlinks, or submodules. All shell hooks and filter scripts used here were created by this probe inside its disposable directory.
