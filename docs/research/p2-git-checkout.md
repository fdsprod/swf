# P2 Git checkout-filter learning result

Observed with Git 2.51.0.windows.2 on Windows on 2026-09-26. The isolated probe imports no product code, creates a temporary repository, and disables hooks for its own commands. It does not modify global configuration or a user repository.

```powershell
node tests/learning/p2/git-checkout-probe.mjs .p2-proof/git-checkout-learning
```

A committed `.gitattributes` file selected `text eol=crlf` for a text file. The Git blob contained LF bytes, but a new worktree contained CRLF bytes even with `core.autocrlf=false`. Plain `cat-file blob` therefore cannot represent the pristine checkout for diff policy checks.

`git --attr-source=<base SHA> cat-file --filters <base SHA>:document.txt` returned the exact CRLF checkout bytes. After the probe changed the worktree attributes to `eol=lf`, ordinary `cat-file --filters` returned LF. The command with the pinned attribute source continued to return the original CRLF bytes. Baseline reconstruction must pin both the blob commit and its attribute source.

The evidence file `.p2-proof/git-checkout-learning/git-checkout-observations.json` records the installed version, every command's arguments, output, and SHA-256 digest. The temporary repository remains at the recorded path. This probe covers line-ending conversion; it does not prove that arbitrary external smudge filters are deterministic.
