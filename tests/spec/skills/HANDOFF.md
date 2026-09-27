# Skills test handoff

The authority is [the public contract](../skills-contract.md). The feature branch is based on merged Unicode fix `f9269fbf1b4df8f3faca08ab2d54b4320df1d024`.

The independent author owns this test directory and contract. Product work must not edit them. Public type and schema changes are additive implementation scope. Do not apply earlier phase schema freeze hashes unchanged to the new feature. Preserve earlier test bytes and run relevant legacy checks after the new behavior passes.

Before implementation, commit the independent tests and record focused behavioral red against the exact baseline, with typecheck/build, source and test hashes, and zero skipped tests. Then launch the actual factory worker with the contract as a pinned design input and the frozen tests as read-only verification authority. Host-side frozen process tests remain required because nested native sandbox setup has not been proved inside the factory verifier.

Final verification uses a clean exact candidate, the committed external suite, and preserved hashes. Live P3/P5 and P6 self-hosting requirements remain separate and must not be inferred from this feature's local tests.
