import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  withFixture,
  run,
  resume,
  status,
  runArgs,
  fault,
  killFactory,
  readStore,
  gateway,
  updateGateway,
  posts,
  remoteRefs,
  normalizedRequest,
  sourceSnapshot,
  assertNoDelivery,
  assertPinnedTransport,
  assertError,
  writeConfig,
  git,
  contexts,
  addAnswer,
  artifactFiles,
  trustedRoot,
} from "../harness/support.mjs";
import { assertDurable, assertArtifacts } from "../harness/replay.mjs";
import {
  assertDeliveredTree,
  commitFixture,
  observedGit,
} from "../harness/git-oracle.mjs";

test("P5-001/002/003: issue produces one exact verified commit and traceable PR", () =>
  withFixture((f) => {
    const original = sourceSnapshot(f);
    const request = normalizedRequest(f);
    const p = assertDurable(run(f), f, "VERIFIED");
    assertArtifacts(p);
    assertDeliveredTree(p, f);
    assertPinnedTransport(p, f);
    assert.deepEqual(p.contract.config.request, request);
    assert.equal(p.ci.kind, "passed");
    assert.equal(posts(f).length, 1);
    assert.equal(remoteRefs(f).length, 1);
    assert.deepEqual(sourceSnapshot(f), original);
    const pr = gateway(f).pulls[0];
    for (const text of [
      p.runId,
      p.intake.issue.url,
      p.delivery.commit.sha,
      p.verification.evidence.digest,
    ]) {
      assert.ok(pr.body.includes(text), "Traceability must include " + text);
    }
    assert.ok(posts(f)[0].facts.some((x) => x.type === "PrStarted"));
    assert.ok(posts(f)[0].facts.some((x) => x.type === "PushConfirmed"));
    assert.equal(
      gateway(f).calls.every((c) => c.hostname === "github.com"),
      true,
    );
    const calls = gateway(f).calls.length;
    assert.deepEqual(
      assertDurable(status(f), f, "VERIFIED", "durable_status"),
      p,
    );
    assert.equal(gateway(f).calls.length, calls);
    const repeated = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(repeated.delivery.commit.sha, p.delivery.commit.sha);
    assert.equal(posts(f).length, 1);
    assert.equal(
      readStore(f).events.filter((e) => e.fact.type === "CommitCreated").length,
      1,
    );
  }));

test("P5-001: immutable issue snapshot survives edits and parsed-input key reordering", async () =>
  withFixture(async (f) => {
    const request = normalizedRequest(f);
    const held = await fault(f, "transaction.after_commit", "RunCreated", {
      args: runArgs(f),
    });
    await killFactory(held);
    updateGateway(f, (d) => {
      d.issue.title = "Remote title edited later";
      d.issue.body = "Different request";
    });
    writeFileSync(
      f.configPath,
      JSON.stringify(
        Object.fromEntries(Object.entries(f.githubConfig).reverse()),
        null,
        2,
      ),
    );
    const p = assertDurable(run(f), f, "VERIFIED");
    assert.deepEqual(p.contract.config.request, request);
    assert.equal(
      gateway(f).calls.filter((c) =>
        c.endpoint?.split("?")[0].endsWith("/issues/7"),
      ).length,
      1,
    );
  }));

for (const defect of [
  "pull-request-shaped",
  "empty-title",
  "wrong-repository",
  "wrong-base",
]) {
  test(`P5-001: ${defect} intake cannot launch product work or delivery`, () =>
    withFixture((f) => {
      updateGateway(f, (d) => {
        if (defect === "pull-request-shaped") {
          d.issue.pull_request = {
            url: "https://api.github.com/repos/factory-fixture/delivery/pulls/7",
          };
        }
        if (defect === "empty-title") {
          d.issue.title = " ";
        }
        if (defect === "wrong-repository") {
          d.repository.full_name = "other/repository";
        }
        if (defect === "wrong-base") {
          d.base.commit.sha = "a".repeat(40);
        }
      });
      assertError(run(f), "input_error");
      assertNoDelivery(f);
      assert.equal(
        git(f.repo, "worktree", "list", "--porcelain")
          .split("\n")
          .filter((s) => s.startsWith("worktree ")).length,
        1,
      );
    }));
}

test("P5-001/003: later target-base advancement retains the initially verified parent", async () =>
  withFixture(async (f) => {
    const held = await fault(f, "transaction.after_commit", "RunCreated", {
      args: runArgs(f),
    });
    await killFactory(held);
    const tree = git(f.repo, "rev-parse", "HEAD^{tree}");
    const advanced = observedGit(
      f,
      ["-C", f.repo, "commit-tree", tree, "-p", f.base],
      Buffer.from("External base advancement\n"),
    )
      .toString()
      .trim();
    git(f.repo, "push", f.remote, advanced + ":refs/heads/main");
    updateGateway(f, (d) => {
      d.base.commit.sha = advanced;
    });
    const p = assertDurable(resume(f), f, "VERIFIED");
    assert.equal(p.delivery.plan.commit.parent, f.base);
    assert.equal(p.delivery.pullRequest.base.sha, advanced);
    assertDeliveredTree(p, f);
  }));

test("P5-002: failed local checks prevent commit, push and PR", () =>
  withFixture({ worker: "lie" }, (f) => {
    const p = assertDurable(run(f), f, "REPAIR_READY");
    assert.equal(p.delivery.kind, "unplanned");
    assert.equal(p.ci.kind, "unobserved");
    assertNoDelivery(f);
  }));

test("P5-002: standard CRLF checkout bytes survive commit representation", () =>
  withFixture((f) => {
    writeFileSync(join(f.repo, ".gitattributes"), "*.txt text eol=crlf\n");
    writeFileSync(join(f.repo, "protected.txt"), "keep\n");
    commitFixture(f, "CRLF attributes baseline");
    const p = assertDurable(run(f), f, "VERIFIED");
    assert.equal(
      readFileSync(join(p.workspace.workspace.path, "protected.txt"), "utf8"),
      "keep\r\n",
    );
    assertDeliveredTree(p, f);
  }));

test("P5-002: base executable mode, deletion and new spaced path survive delivery", () =>
  withFixture((f) => {
    writeFileSync(join(f.repo, "src/run.sh"), "#!/bin/sh\necho original\n");
    writeFileSync(join(f.repo, "src/delete-me.txt"), "delete this\n");
    git(f.repo, "add", "src/run.sh", "src/delete-me.txt");
    git(f.repo, "update-index", "--chmod=+x", "src/run.sh");
    commitFixture(f, "Executable and removable base files");
    assert.match(git(f.repo, "ls-tree", f.base, "src/run.sh"), /^100755 blob /);
    const worker = join(f.trusted, "p5-mode-worker.cjs");
    copyFileSync(
      join(trustedRoot, "tests/spec/p5/fixtures/mode-worker.cjs"),
      worker,
    );
    f.githubConfig.runtime.worker.prefixArgs = [worker, f.root];
    writeConfig(f);
    const p = assertDurable(run(f), f, "VERIFIED");
    assertDeliveredTree(p, f);
    const files = JSON.parse(
      readFileSync(p.delivery.plan.snapshot.path, "utf8"),
    ).files;
    assert.equal(files.find((x) => x.path === "src/run.sh").mode, "100755");
    assert.equal(
      files.find((x) => x.path === "src/new file.txt").mode,
      "100644",
    );
    assert.equal(
      files.some((x) => x.path === "src/delete-me.txt"),
      false,
    );
  }));

for (const unsupported of ["custom-filter", "info-attributes"]) {
  test(`P5-002: unsupported ${unsupported} is rejected without running credential-side code`, () =>
    withFixture((f) => {
      const sentinel = join(f.root, "filter-ran");
      const script = join(f.trusted, "filter.cjs");
      writeFileSync(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'ran');process.stdin.pipe(process.stdout);`,
      );
      if (unsupported === "custom-filter") {
        writeFileSync(join(f.repo, ".gitattributes"), "*.cjs filter=unsafe\n");
        git(f.repo, "add", ".gitattributes");
        git(f.repo, "commit", "-m", "Filter attributes");
        f.base = git(f.repo, "rev-parse", "HEAD");
        git(f.repo, "push", "origin", "HEAD:refs/heads/main");
        updateGateway(f, (d) => {
          d.base.commit.sha = f.base;
        });
        git(
          f.repo,
          "config",
          "filter.unsafe.clean",
          `"${process.execPath.replaceAll("\\", "/")}" "${script.replaceAll("\\", "/")}"`,
        );
        git(f.repo, "config", "filter.unsafe.required", "true");
      } else {
        writeFileSync(
          join(f.repo, ".git/info/attributes"),
          "*.txt text eol=crlf\n",
        );
      }
      assertError(run(f), "delivery_error");
      assertNoDelivery(f);
      assert.equal(existsSync(sentinel), false);
    }));
}

test("P5-003/004: source hooks and inherited delivery credentials never reach worker or artifacts", () =>
  withFixture({ worker: "restrictions" }, (f) => {
    const hooks = join(f.root, "hooks");
    const sentinel = join(f.root, "hook-ran");
    const secret = "p5-private-credential-" + Date.now();
    mkdirSync(hooks);
    writeFileSync(
      join(hooks, "pre-push"),
      `#!/bin/sh\nprintf ran > '${sentinel.replaceAll("\\", "/")}'\n`,
    );
    git(f.repo, "config", "core.hooksPath", hooks);
    const p = assertDurable(
      run(f, undefined, {
        env: {
          GH_TOKEN: secret,
          GITHUB_TOKEN: secret,
          GH_HOST: "hostile.invalid",
        },
      }),
      f,
      "VERIFIED",
    );
    assert.equal(existsSync(sentinel), false);
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(p.workspace.workspace.path, "src/restrictions.json"),
          "utf8",
        ),
      ).deliveryEnvironment,
      [],
    );
    for (const file of artifactFiles(f.githubConfig.runtime.artifactRoot)) {
      assert.equal(
        readFileSync(file).includes(Buffer.from(secret)),
        false,
        "Credential leaked into " + file,
      );
    }
    assertDeliveredTree(p, f);
  }));

test("P5-001/007: distinct gateway program bytes are immutable even without decisions", async () =>
  withFixture(async (f) => {
    const held = await fault(f, "transaction.after_commit", "RunCreated", {
      args: runArgs(f),
    });
    await killFactory(held);
    const before = readStore(f);
    const calls = gateway(f).calls.length;
    appendFileSync(f.githubConfig.github.executable, "changed bytes");
    assertError(resume(f), "artifact_invalid");
    assert.deepEqual(readStore(f), before);
    assert.equal(gateway(f).calls.length, calls);
    assertNoDelivery(f);
  }));

test("P5-007: issue enters the existing bounded repair loop before delivery", () =>
  withFixture({ repair: true }, (f) => {
    const p = assertDurable(run(f), f, "VERIFIED");
    assert.equal(p.repairs.length, 1);
    assert.equal(p.attempts.length, 2);
    assert.equal(contexts(f).length, 2);
    assertDeliveredTree(p, f);
    assert.equal(posts(f).length, 1);
  }));

test("P5-007: unresolved human decision blocks delivery; answer then repair retains one run", () =>
  withFixture(
    { repair: true, decisions: true, worker: "decision-before" },
    (f) => {
      const waiting = assertDurable(run(f), f, "WAITING_FOR_DECISION");
      assertNoDelivery(f);
      addAnswer(f, waiting.state.decision.id);
      const p = assertDurable(resume(f), f, "VERIFIED");
      assert.equal(p.runId, waiting.runId);
      assert.equal(p.repairs.length, 1);
      assert.equal(p.attempts.length, 3);
      assert.equal(p.decisions[0].kind, "resolved");
      assertDeliveredTree(p, f);
    },
  ));
