# P5 worktree checkout hooks and attributes

Observed on 2026-09-26 with Git 2.51.0.windows.2 and Node 22.22.3 on Windows. Keep [the isolated probe](../../tests/learning/p5/worktree-checkout-probe.mjs) as dependency documentation. It imports no product code and creates only disposable local repositories, owned hook/filter programs and one fixed dummy `GH_TOKEN`. It reads no real credentials, performs no network requests and changes no user Git configuration.

```powershell
node tests/learning/p5/worktree-checkout-probe.mjs
```

The first argument can select a report path. The successful extended run retained `C:/Users/fdspr/AppData/Local/Temp/swf-p5-worktree-checkout-Tkrg36/observations.json`. It records command arguments, exits, hook/filter process IDs, working directories and a boolean that confirms dummy credential inheritance. It records no credential bytes or hashes.

## Observations

The source repository configured an owned `post-checkout` hook and smudge filter. A fixture global attributes file selected that filter for `*.txt`. The pinned base contained ordinary `*.txt text eol=crlf` attributes. Each case ran `--attr-source=<base> worktree add --detach <new path> <base>`.

| Command-scoped boundary | Observed execution | Checked-out text |
| --- | --- | --- |
| None | Source post-checkout hook and global-attribute-selected filter | Uppercase, CRLF |
| `core.hooksPath=<owned empty directory>` | Filter only | Uppercase, CRLF |
| `core.attributesFile=` plus `GIT_ATTR_NOSYSTEM=1` | Source post-checkout hook only | Original lowercase, CRLF |
| Both empty hook directory and empty global attributes | Neither | Original lowercase, CRLF |
| Literal `core.hooksPath=` plus empty global attributes | Neither in this fixture | Original lowercase, CRLF |

Every executed hook and filter inherited the fixed dummy `GH_TOKEN` and could write the sentinel outside the new checkout. They were Git child processes, not the product worker. The post-checkout hook ran with the new worktree as its current directory and received the all-zero old commit, pinned new commit and branch-checkout flag `1`. This agrees with Git's documented [post-checkout behavior for worktree add](https://git-scm.com/docs/githooks#_post_checkout).

Pinning the attribute source did not suppress the inherited global filter. Disabling hooks alone did not suppress the filter either. Empty global attributes preserved the pinned base's ordinary CRLF transformation. The attributes file itself remained unchanged in every new checkout.

An extra tracked root-level file named `post-checkout` did not execute in the literal-empty-hooks case. The proposed boundary still uses an explicit factory-owned empty hooks directory, which is easier to audit than depending on the meaning of an empty path. `GIT_ATTR_NOSYSTEM=1` was supplied throughout; this fixture did not modify or positively exercise an installed system attributes file.

## Diff also invokes clean filters

The extended probe configured an owned clean filter through the same inherited global attribute selection, then changed the correctly checked-out CRLF file. This command still invoked the clean filter, which inherited the dummy token:

```text
git --attr-source=<base> diff --binary --no-ext-diff --no-textconv <base> -- ordinary.txt
```

The candidate contained lowercase `changed actual content` with CRLF. The diff incorrectly represented the filter-transformed uppercase text. The clean callback ran twice in this installation; the probe requires at least one invocation and does not make the exact count a contract. External diff and textconv suppression do not suppress Git's clean conversion of working-tree bytes.

A controlled bare Git directory with a private index, the source common object directory, empty hooks, empty global attributes/config and disabled system attributes produced the correct lowercase patch. It read the pinned base into the private index first. The patch passed `apply --cached --check`, applied to that private index, and yielded the expected lowercase LF blob. The working candidate retained its exact lowercase CRLF bytes, both ordinary source/worktree indexes stayed unchanged, and no additional filter or hook callback ran.

## Minimum P5 boundary implied by the evidence

The existing P5 exclusion of source hooks, inherited attributes and worker-selected credential-side code must cover initial worktree creation and verification diff capture. Applying it only to final staging/push is too late. Use command-scoped empty hooks, exclude inherited global/system attributes and configuration, and keep those child environments free of delivery credentials. Preserve ordinary pinned-base attributes. Source info attributes and custom filters remain subject to the existing P5 rejection policy; this probe does not broaden supported input.

A focused acceptance regression can configure an owned source `post-checkout` sentinel before `run --github` and pass a fixed dummy token. The run must not execute that hook or expose the dummy value through it. A separate global-attribute fixture can distinguish required ordinary CRLF handling from inherited clean/smudge filter execution over the entire checkout, verification and delivery run. These are proposed observations only; this learning task adds no product or acceptance tests.

This probe does not establish sandbox behavior, malicious native binaries, all hook types, remote credentials, HTTPS push permissions or live GitHub delivery. The live boundary proof remains required.
