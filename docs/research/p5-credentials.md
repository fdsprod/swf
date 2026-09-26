# P5 Git credential transport learning

Observed on 2026-09-26 with Git 2.51.0.windows.2, gh 2.92.0 and Node 22.22.3 on Windows. Keep [the probe](../../tests/learning/p5/credential-transport-probe.mjs) and its [helper fixture](../../tests/learning/p5/credential-helper-fixture.cjs) as dependency documentation outside the product suite.

```powershell
node tests/learning/p5/credential-transport-probe.mjs
```

The optional first argument selects the report path. The final run retained `C:/Users/fdspr/AppData/Local/Temp/swf-p5-credential-learning-EuJpdE/observations.json`. It completed all observations in about three seconds. The initial exploratory run expected only a branch from unfiltered `ls-remote`; Git also reported HEAD. The final probe requests `refs/heads/main` explicitly.

All credentials were fixed dummy values. The probe removes inherited Git, GitHub and proxy settings, supplies separate dummy `GH_TOKEN` and `GH_ENTERPRISE_TOKEN`, and uses an empty private `GH_CONFIG_DIR`. It neither reads real credentials nor performs GitHub requests. Helper protocol values stay in process memory; reports retain classifications, not password values or hashes. Its HTTP server accepts only reads on loopback. No global Git configuration or remote refs change.

## Native helper invocation

Git successfully invoked the installed native executable through this command-scoped helper value:

```text
credential.helper=
credential.https://github.com.helper=!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential
```

These are separate `-c` arguments passed to Git with an argv array. The exclamation prefix selects a shell command. The probe converts absolute Windows paths to forward slashes and applies POSIX single-quote escaping to each argument. A second native helper fixture also worked from paths containing spaces, a dollar sign and an apostrophe. This is an observed quoting recipe for trusted paths; it does not authorize worker-supplied shell text. Git documents helper shell execution, appended operations and empty-list reset in [gitcredentials](https://git-scm.com/docs/gitcredentials).

Direct native `gh auth git-credential get` returned the dummy GitHub token for HTTPS `github.com` and refused HTTP. `store` and `erase` both exited zero with empty stdout/stderr, wrote no files in the private gh config directory, and left the subsequent dummy credential unchanged. This agrees with the installed version's [upstream helper implementation](https://github.com/cli/cli/blob/v2.92.0/pkg/cmd/auth/gitcredential/helper.go). No operating-system credential-store mutation was exercised or needed.

## Host matching needs an explicit boundary

The native helper is not a policy that permits only `github.com`. Direct requests for `gist.github.com` received the dummy GitHub token. Requests for `github.com.evil.invalid` and `github.com:443` received the dummy enterprise token supplied by this probe.

With the scoped Git helper above and terminal prompts disabled, wrong-host, gist-host and HTTP requests failed with exit 128 and returned no credential. However, `github.com:443` matched Git's default-port URL scope and reached gh, which returned the dummy enterprise credential. Therefore URL-scoped helper configuration alone is not literal-host validation. Delivery must retain its canonical HTTPS destination without userinfo or an explicit port, validate host/scheme itself, and exclude redirects. Do not treat a generally configured gh helper as the transport authority.

The loopback fixture used `http.followRedirects=false`. A 302 to another hostname failed before contacting that destination or sending authorization. A request through a different hostname also failed without a helper call or Authorization header. This observed HTTP behavior does not establish every HTTPS redirect or proxy case.

## Helper and repository isolation

A source repository's configured helper ran in a positive control. A later command with empty `credential.helper` followed by the trusted fixture helper ran only the latter. Another control proved inherited `GIT_CONFIG_COUNT/KEY/VALUE` can install a helper. Removing those inherited variables excluded it.

An explicit factory-owned `--git-dir` remained isolated while the command's working directory was the source repository. The controlled config listing contained neither the source helper nor its URL rewrite. The source config bytes stayed unchanged. System config was disabled, global config and global attributes pointed to empty fixture files, and the command used an empty hooks directory. Git documents the distinct repository and command configuration scopes in [git-config](https://git-scm.com/docs/git-config). A helper-list reset alone does not remove source URL rewrites or other source configuration.

The authenticated loopback `ls-remote` observed `get` then `store`; a server that continued to reject the dummy credential observed `get` then `erase`. `credential.useHttpPath=true` included `repo.git` in helper requests. The fake helper recorded only operation/context and whether a supplied password matched the known dummy. It persisted no password.

## Limits

This proves native invocation, dummy protocol handling, command-scoped helper reset, controlled Git configuration and a read-only HTTP authentication exchange. It does not prove TLS trust, a real GitHub credential, authenticated HTTPS push, repository permissions, branch protection, or operating-system credential access. Even a successful public GitHub read would not prove authenticated push. P5's selected-repository live push/PR/CI proof remains mandatory and blocked until that destination is available. No P5 acceptance contract or product implementation changed during this learning work.
