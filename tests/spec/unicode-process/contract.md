# Exact Unicode process transport

Owned-process execution must preserve each argument string and filesystem path
exactly, including non-ASCII characters. This includes a regular tracked Git
filename with U+2014, accented characters, CJK text, and supplementary Unicode
characters. Passing a correct in-memory ProcessRecord is insufficient: observe
what the actual child receives. ASCII launch remains a positive control.

The P5 end-to-end case uses a real local Git repository and bare remote. It adds
an unchanged Unicode documentation filename to the pinned base, then requires
the normal issue → worker → verifier → commit → PR/CI double flow to succeed.
The delivered commit must retain the exact filename and bytes. Source HEAD,
ordinary index, and original answer file stay unchanged.

Run from the trusted checkout after building the candidate:

```powershell
$env:FACTORY_CANDIDATE_ROOT = 'C:/path/to/held-candidate'
node --test --test-concurrency=1 tests/spec/unicode-process/transport.test.mjs tests/spec/unicode-process/delivery.test.mjs
```

These tests import the exported `processInJob` boundary and the existing P5
black-box harness. They do not inspect the process helper implementation or its
internal serialized job file. Temporary child evidence stays under
`swf-unicode-process-*` for diagnosis. The live first-workflow failure motivates
the case; it does not define an implementation technique.

The lower-level test currently needs a built candidate and native Windows Job
support. Reusing it inside the factory's restricted verifier requires a separate
proof that the nested owned-process helper is permitted by that sandbox, plus
an external trusted compilation directory. No sandbox compatibility is claimed
by the host-side red/green run.
