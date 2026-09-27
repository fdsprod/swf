import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  fixture,
  run,
  check,
  assertLocal,
  assertRejected,
  assertInvalid,
  git,
  ownedProcesses,
  launch,
  candidateRoot,
} from "../harness/support.mjs";

function assertProcessGone(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try {
    process.kill(pid, 0);
    assert.fail(`Owned child ${pid} remains alive`);
  } catch (error) {
    assert.equal(
      error.code,
      "ESRCH",
      `Child liveness must be known: ${error.message}`,
    );
  }
}

test("P1-001 real worktree edit and independent pinned command produce bound evidence", () => {
  const f = fixture();
  try {
    const o = run(f);
    const m = assertLocal(o, f, "VERIFIED");
    assert.equal(
      readFileSync(join(o.result.workspace.path, "src/answer.cjs"), "utf8"),
      "module.exports = 42;\n",
    );
    assert.equal(git(o.result.workspace.path, "rev-parse", "HEAD"), f.base);
    assert.equal(m.worker.process.termination.kind, "exited");
    assert.equal(m.worker.process.termination.exitCode, 0);
    assert.equal(m.commands.length, 1);
    assert.equal(m.commands[0].specId, "answer");
    assert.deepEqual(m.commands[0].process.args, f.config.commands[0].args);
    assert.equal(m.commands[0].process.cwd, o.result.workspace.path);
    assert.deepEqual(m.commands[0].process.termination, {
      kind: "exited",
      exitCode: 0,
    });
    assert.match(
      readFileSync(m.commands[0].process.stdout.path, "utf8"),
      /verified:42/,
    );
    assert.match(
      readFileSync(m.commands[0].process.stderr.path, "utf8"),
      /verifier-stderr/,
    );
    assert.ok(m.changedPaths.includes("src/answer.cjs"));
    assert.ok(m.candidate.files.some((file) => file.path === "src/answer.cjs"));
    assert.ok(
      m.contract.programs.some((file) => file.path.endsWith("helper.cjs")),
    );
    const events = o.result.events.map((e) => e.type);
    assert.ok(
      events.indexOf("AgentInvocationFinished") <
        events.indexOf("VerificationStarted"),
    );
    assert.equal(check(o.result.evidence.path).result.status, "current");
  } finally {
    f.cleanup();
  }
});

test("P1-002 worker completion cannot approve wrong behavior", () => {
  const f = fixture({ worker: "lie" });
  try {
    const o = run(f);
    const m = assertLocal(o, f, "REPAIR_READY");
    assert.equal(m.worker.outcome.kind, "completed");
    assert.equal(m.commands[0].process.termination.exitCode, 1);
    assertInvalid(check(o.result.evidence.path));
  } finally {
    f.cleanup();
  }
});

for (const mode of [
  "malformed",
  "malformed-events",
  "duplicate-terminal",
  "turn-failed",
  "absent",
  "nonzero",
  "blocked",
  "failed",
]) {
  test(`P1-003 ${mode} worker cannot invoke verifier`, () => {
    const f = fixture({ worker: mode });
    try {
      const o = run(f);
      const m = assertLocal(o, f, "FAILED");
      assert.equal(m.commands.length, 0);
      assert.equal(
        o.result.events.some((e) => e.type === "VerificationStarted"),
        false,
      );
      assert.notEqual(m.worker.outcome.kind, "completed");
    } finally {
      f.cleanup();
    }
  });
}

test("P1-003 intermediate Codex prose does not hide the final structured outcome", () => {
  const f = fixture({ worker: "intermediate" });
  try {
    assertLocal(run(f), f, "VERIFIED");
  } finally {
    f.cleanup();
  }
});

for (const [mode, status, termination] of [
  ["nonzero", "REPAIR_READY", "exited"],
  ["hang", "FAILED", "timeout"],
]) {
  test(`P1-004 verifier ${mode} rejects claimed completion`, () => {
    const f = fixture({ verifier: mode });
    try {
      const o = run(f);
      const m = assertLocal(o, f, status);
      assert.equal(m.commands[0].process.termination.kind, termination);
      assertInvalid(check(o.result.evidence.path));
    } finally {
      f.cleanup();
    }
  });
}

test("P1-005 forbidden product edit blocks verification acceptance", () => {
  const f = fixture({ worker: "forbidden" });
  try {
    const o = run(f);
    assert.equal(o.result.kind, "local_run_result");
    assert.notEqual(o.result.state.status, "VERIFIED");
    assertInvalid(check(o.result.evidence.path));
  } finally {
    f.cleanup();
  }
});

test("P1-006 changing candidate test scripts cannot approve wrong product", () => {
  const f = fixture({ worker: "tamper-tests" });
  try {
    const o = run(f);
    assert.equal(o.result.kind, "local_run_result");
    assert.notEqual(o.result.state.status, "VERIFIED");
    assert.equal(
      readFileSync(
        join(o.result.workspace.path, "tests/protected.cjs"),
        "utf8",
      ),
      'throw new Error("Candidate test is not the trusted judge");\n',
    );
    assertInvalid(check(o.result.evidence.path));
  } finally {
    f.cleanup();
  }
});

test("P1-007 real restriction denies writes and credential reads while allowing product edit", () => {
  const f = fixture({ worker: "restrictions" });
  try {
    const o = run(f, {
      env: {
        GH_TOKEN: "fake-delivery-token",
        GITHUB_TOKEN: "fake-delivery-token",
        GIT_ASKPASS: "fake-askpass",
        SSH_AUTH_SOCK: "fake-agent",
        CODEX_API_KEY: "fake-model-key",
        OPENAI_API_KEY: "fake-model-key",
      },
    });
    assertLocal(o, f, "VERIFIED");
    const report = JSON.parse(
      readFileSync(
        join(o.result.workspace.path, "src/restrictions.json"),
        "utf8",
      ),
    );
    for (const key of [
      "external",
      "protected",
      "source",
      "git",
      "gitPointer",
      "credentials",
    ]) {
      assert.match(
        report[key],
        /^E(ACCES|PERM)$/u,
        `${key} must be denied by the operating restriction`,
      );
    }
    assert.deepEqual(report.deliveryEnvironment, []);
    assert.ok(report.args.includes("--ignore-user-config"));
    assert.ok(
      report.args.some(
        (arg, index) =>
          arg === "-c" && report.args[index + 1] === "mcp_servers={}",
      ),
      "Explicit empty MCP table is required",
    );
    assert.equal(
      readFileSync(join(f.root, "external.txt"), "utf8"),
      "external-original",
    );
    assert.equal(
      readFileSync(join(f.root, "credentials.txt"), "utf8"),
      "fake-delivery-credential",
    );
    assert.equal(
      readFileSync(join(f.repo, ".git/protected.txt"), "utf8"),
      "git-original",
    );
  } finally {
    f.cleanup();
  }
});

test("P1-008 verification-time content mutation invalidates passed command", () => {
  const f = fixture({ verifier: "mutate" });
  try {
    const o = run(f);
    assert.equal(o.result.kind, "local_run_result");
    assert.notEqual(o.result.state.status, "VERIFIED");
    assertInvalid(check(o.result.evidence.path));
  } finally {
    f.cleanup();
  }
});

for (const mutation of [
  "source",
  "added",
  "deleted",
  "verifier",
  "helper",
  "stdout",
  "missing-artifact",
]) {
  test(`P1-009 ${mutation} mutation invalidates evidence`, () => {
    const f = fixture();
    try {
      const o = run(f);
      const m = assertLocal(o, f, "VERIFIED");
      assert.equal(check(o.result.evidence.path).result.status, "current");
      const workspace = o.result.workspace.path;
      if (mutation === "source") {
        writeFileSync(
          join(workspace, "src/answer.cjs"),
          "module.exports = 43;\n",
        );
      }
      if (mutation === "added") {
        writeFileSync(join(workspace, "src/late.cjs"), "late file\n");
      }
      if (mutation === "deleted") {
        rmSync(join(workspace, "src/answer.cjs"));
      }
      if (mutation === "verifier") {
        writeFileSync(join(f.trusted, "verifier.cjs"), "process.exit(0);\n");
      }
      if (mutation === "helper") {
        writeFileSync(join(f.trusted, "helper.cjs"), "module.exports = 0;\n");
      }
      if (mutation === "stdout") {
        writeFileSync(m.commands[0].process.stdout.path, "tampered");
      }
      if (mutation === "missing-artifact") {
        rmSync(m.commands[0].process.stderr.path);
      }
      assertInvalid(check(o.result.evidence.path));
    } finally {
      f.cleanup();
    }
  });
}

for (const [worker, verifier, status, pidFile, heartbeat] of [
  ["hang-child", "good", "FAILED", "child.pid", "heartbeat.txt"],
  ["detached", "good", "VERIFIED", "child.pid", "heartbeat.txt"],
  ["good", "detached", "VERIFIED", null, null],
]) {
  test(`P1-010 descendants stop for worker ${worker}, verifier ${verifier}`, async () => {
    const f = fixture({ worker, verifier });
    try {
      const o = run(f);
      const m = assertLocal(o, f, status);
      const workspace = o.result.workspace.path;
      let childPid;
      if (pidFile) {
        assert.ok(
          existsSync(join(workspace, "src", pidFile)),
          "Fixture child must have started",
        );
        childPid = Number(
          readFileSync(join(workspace, "src", pidFile), "utf8"),
        );
      } else {
        const output = readFileSync(m.commands[0].process.stdout.path, "utf8");
        assert.match(
          output,
          /child-pid:\d+/,
          "Fixture verifier child must have started",
        );
        childPid = Number(output.match(/child-pid:(\d+)/)[1]);
      }
      if (worker === "hang-child") {
        assert.equal(m.worker.process.termination.kind, "timeout");
        assert.equal(m.commands.length, 0);
      }
      const beat = heartbeat ? join(workspace, "src", heartbeat) : null;
      const before =
        beat && existsSync(beat) ? readFileSync(beat, "utf8") : null;
      await delay(700);
      assert.equal(
        beat && existsSync(beat) ? readFileSync(beat, "utf8") : null,
        before,
        "Child cannot continue writing after factory result",
      );
      assert.deepEqual(
        ownedProcesses(f),
        [],
        "No process from the fixture executable can survive the result",
      );
      assertProcessGone(childPid);
      if (status === "VERIFIED") {
        assert.equal(check(o.result.evidence.path).result.status, "current");
      }
    } finally {
      f.cleanup();
    }
  });
}

test("P1-013 verifier candidate execution cannot rewrite its judge or factory state", () => {
  const f = fixture({ verifier: "restrictions" });
  try {
    const o = run(f);
    const m = assertLocal(o, f, "VERIFIED");
    const line = readFileSync(m.commands[0].process.stdout.path, "utf8")
      .split("\n")
      .find((line) => line.startsWith("restriction-report:"));
    assert.ok(line);
    const report = JSON.parse(line.slice("restriction-report:".length));
    for (const key of ["bundle", "artifact", "source", "credentials"]) {
      assert.match(report[key], /^E(ACCES|PERM)$/u);
    }
    assert.equal(
      readFileSync(join(f.trusted, "helper.cjs"), "utf8"),
      "module.exports = 42;\n",
    );
  } finally {
    f.cleanup();
  }
});

test("P1-014 explicit cancellation stops worker descendants before returning", async () => {
  const f = fixture({ worker: "hang-child" });
  try {
    f.config.worker.timeoutSeconds = 30;
    const configPath = join(f.root, "cancel-config.json");
    const entrypoint = join(f.root, "cancel-run.mjs");
    writeFileSync(configPath, JSON.stringify(f.config));
    const moduleUrl = pathToFileURL(
      join(candidateRoot, "dist/cli/local.js"),
    ).href;
    writeFileSync(
      entrypoint,
      `import {runLocal} from ${JSON.stringify(moduleUrl)};import {readdirSync} from 'node:fs';const controller=new AbortController();const watcher=setInterval(()=>{try{if(readdirSync(${JSON.stringify(f.config.workspaceRoot)},{recursive:true}).some(p=>p.endsWith('child.pid')))controller.abort();}catch{}},100);const timeout=setTimeout(()=>controller.abort(),20000);const result=await runLocal(${JSON.stringify(configPath)},controller.signal);clearInterval(watcher);clearTimeout(timeout);console.log(JSON.stringify(result));process.exitCode=result.kind==='not_implemented'?3:result.kind==='local_run_result'?(result.state.status==='VERIFIED'?0:1):2;`,
    );
    const o = launch([], { entrypoint });
    const m = assertLocal(o, f, "FAILED");
    assert.equal(m.worker.process.termination.kind, "cancelled");
    assert.equal(m.commands.length, 0);
    assert.ok(
      existsSync(join(o.result.workspace.path, "src/child.pid")),
      "Cancellation must occur after the child starts",
    );
    await delay(500);
    assert.deepEqual(ownedProcesses(f), []);
    assertProcessGone(
      Number(
        readFileSync(join(o.result.workspace.path, "src/child.pid"), "utf8"),
      ),
    );
  } finally {
    f.cleanup();
  }
});

const invalidCases = {
  "unknown field": (c) => {
    c.unrecognized = true;
  },
  "missing command": (c) => {
    c.commands = [];
  },
  "duplicate command": (c) => {
    c.commands.push({ ...c.commands[0] });
  },
  "unknown command": (c) => {
    c.commands[0].specId = "unknown";
  },
  "escaping cwd": (c) => {
    c.verification.required[0].cwd = "../";
  },
  "absolute cwd": (c) => {
    c.verification.required[0].cwd = c.artifactRoot;
  },
  "escaping allowed path": (c) => {
    c.allowedPaths = ["../"];
  },
  "artifacts inside repository": (c) => {
    c.artifactRoot = join(c.repositoryPath, "artifacts");
  },
  "workspace inside repository": (c) => {
    c.workspaceRoot = join(c.repositoryPath, "workspaces");
  },
  "artifact workspace overlap": (c) => {
    c.artifactRoot = c.workspaceRoot;
  },
  "verification input inside workspace": (c) => {
    c.verificationInputs = [c.workspaceRoot];
  },
  "worker policy override": (c) => {
    c.worker.prefixArgs.push("--dangerously-bypass-approvals-and-sandbox");
  },
  "worker configuration override": (c) => {
    c.worker.prefixArgs.push("-c", 'approval_policy="never"');
  },
  "invalid base revision": (c) => {
    c.request.repository.baseRef = "does-not-exist";
  },
  "unbounded timeout": (c) => {
    c.worker.timeoutSeconds = 0;
  },
};
for (const [name, mutate] of Object.entries(invalidCases)) {
  test(`P1-011 reject ${name} before worker`, () => {
    const f = fixture();
    try {
      mutate(f.config);
      assertRejected(run(f));
      assert.equal(
        git(f.repo, "worktree", "list", "--porcelain")
          .split("\n")
          .filter((line) => line.startsWith("worktree ")).length,
        1,
      );
    } finally {
      f.cleanup();
    }
  });
}

for (const location of ["project", "ancestor"]) {
  test(`P1-015 reject ${location} Codex host configuration before execution`, () => {
    const f = fixture();
    try {
      const directory = join(
        location === "project" ? f.repo : f.root,
        ".codex",
      );
      mkdirSync(directory);
      writeFileSync(
        join(directory, "config.toml"),
        '[mcp_servers.untrusted]\ncommand = "must-never-start"\n',
      );
      if (location === "project") {
        git(f.repo, "add", ".codex/config.toml");
        git(f.repo, "commit", "-m", "untrusted project configuration");
      }
      assertRejected(run(f));
      assert.equal(
        git(f.repo, "worktree", "list", "--porcelain")
          .split("\n")
          .filter((line) => line.startsWith("worktree ")).length,
        1,
      );
    } finally {
      f.cleanup();
    }
  });
}

test("P1-012 directory junction cannot place evidence in source repository", () => {
  const f = fixture();
  try {
    const link = join(f.root, "artifact-link");
    symlinkSync(f.repo, link, "junction");
    f.config.artifactRoot = link;
    assertRejected(run(f));
  } finally {
    f.cleanup();
  }
});
