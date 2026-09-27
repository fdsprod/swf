import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withFixture, run, sourceSnapshot } from "../harness/support.mjs";
import { assertDurable } from "../harness/replay.mjs";
import {
  assertDeliveredTree,
  commitFixture,
  observedGit,
} from "../harness/git-oracle.mjs";

const dummy = "DUMMY_P5_CHECKOUT_CREDENTIAL_NOT_A_SECRET";
const quote = (value) =>
  "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
const environment = (globalConfig) => ({
  GIT_CONFIG_GLOBAL: globalConfig,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_ATTR_NOSYSTEM: "1",
  GH_TOKEN: dummy,
  GITHUB_TOKEN: dummy,
  GH_ENTERPRISE_TOKEN: dummy,
  GITHUB_ENTERPRISE_TOKEN: dummy,
});
function sentinelScript(f, name, filter = false) {
  const marker = join(f.root, name + ".jsonl");
  const script = join(f.trusted, name + ".cjs");
  writeFileSync(
    script,
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify({kind:${JSON.stringify(name)},inheritedDummyCredential:process.env.GH_TOKEN===${JSON.stringify(dummy)}})+'\\n');${filter ? "process.stdout.write(fs.readFileSync(0));" : ""}`,
  );
  return {
    marker,
    script,
    command: quote(process.execPath) + " " + quote(script),
  };
}

test("P5-002/003: initial checkout excludes a configured source post-checkout hook", () =>
  withFixture((f) => {
    const hooks = join(f.root, "checkout-hooks");
    const globalConfig = join(f.root, "empty-global-config");
    mkdirSync(hooks);
    writeFileSync(globalConfig, "");
    const hook = sentinelScript(f, "post-checkout");
    writeFileSync(
      join(hooks, "post-checkout"),
      "#!/bin/sh\nexec " + hook.command + ' "$@"\n',
    );
    observedGit(f, ["-C", f.repo, "config", "core.hooksPath", hooks]);
    const before = sourceSnapshot(f);
    const config = readFileSync(join(f.repo, ".git/config"));
    const result = run(f, undefined, { env: environment(globalConfig) });
    assert.equal(
      existsSync(hook.marker),
      false,
      "Configured source post-checkout must never execute during the GitHub run",
    );
    const p = assertDurable(result, f, "VERIFIED");
    assert.equal(p.ci.kind, "passed");
    assertDeliveredTree(p, f);
    assert.deepEqual(sourceSnapshot(f), before);
    assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
  }));

test("P5-002/003: checkout excludes inherited global filters and preserves ordinary base CRLF", () =>
  withFixture((f) => {
    writeFileSync(join(f.repo, ".gitattributes"), "*.txt text eol=crlf\n");
    writeFileSync(join(f.repo, "protected.txt"), "ordinary base content\n");
    commitFixture(f, "Ordinary CRLF checkout baseline");
    const globalConfig = join(f.root, "owned-global-config");
    const attributes = join(f.root, "owned-global-attributes");
    const filter = sentinelScript(f, "global-attribute-filter", true);
    writeFileSync(attributes, "*.txt filter=owned\n");
    for (const [key, value] of [
      ["core.attributesFile", attributes],
      ["filter.owned.smudge", filter.command],
      ["filter.owned.clean", filter.command],
      ["filter.owned.required", "true"],
    ]) {
      observedGit(f, ["config", "--file", globalConfig, key, value]);
    }
    const before = sourceSnapshot(f);
    const config = readFileSync(join(f.repo, ".git/config"));
    const globalBefore = readFileSync(globalConfig);
    const result = run(f, undefined, { env: environment(globalConfig) });
    assert.equal(
      existsSync(filter.marker),
      false,
      "Inherited global attributes must never select credential-side filter code",
    );
    const p = assertDurable(result, f, "VERIFIED");
    assert.equal(p.ci.kind, "passed");
    assert.equal(
      readFileSync(join(p.workspace.workspace.path, "protected.txt"), "utf8"),
      "ordinary base content\r\n",
    );
    assertDeliveredTree(p, f);
    assert.deepEqual(sourceSnapshot(f), before);
    assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
    assert.deepEqual(readFileSync(globalConfig), globalBefore);
  }));
