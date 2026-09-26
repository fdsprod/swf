# P2 named Windows Job learning result

Observed on Windows on 2026-09-26. The isolated PowerShell probe imports no product code.

```powershell
powershell.exe -NoProfile -NonInteractive -File tests/learning/p2/named-job-probe.ps1 -EvidenceDirectory .p2-proof/named-job-learning
```

The supervisor created a named Job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigned one real child, and retained its handle. A separate process opened the name with query access and observed one active process. After the probe killed the supervisor, the child stopped and opening the same name returned Win32 error 2 (`ERROR_FILE_NOT_FOUND`). An unrelated missing name also returned error 2. Other open errors throw; the probe does not classify them as absence. Access-denied behavior was not separately injected.

Evidence is in `.p2-proof/named-job-learning/named-job-observations.json`. Temporary probe files remain in the directory named by that record.

This supports recovery through a stable, trusted Job name when supervisor death prevents a terminal artifact from being written. An absent name alone is insufficient: recovery must also bind that name to the recorded launch, establish that the original supervisor cannot launch more work, and check the observed child identity. The [Windows Job documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) describes Job lifetime and kill-on-close behavior.
