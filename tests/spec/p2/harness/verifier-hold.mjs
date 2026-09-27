import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { trustedRoot, candidateRoot, waitFor } from "./support.mjs";

export async function holdVerifierSupervisor(f, factory) {
  const prefix = join(f.root, `hold-${randomUUID()}`);
  const ready = prefix + ".ready.json";
  const control = prefix + ".control.json";
  const reply = prefix + ".reply.json";
  const child = spawn(
    "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(trustedRoot, "tests/spec/p2/fixtures/hold-verifier-supervisor.ps1"),
      "-FactoryPid",
      String(factory.child.pid),
      "-FactoryScript",
      join(candidateRoot, "dist/cli/main.js"),
      "-FixtureExecutable",
      join(f.root, "node.exe"),
      "-VerifierScript",
      join(f.trusted, "p2-verifier.cjs"),
      "-FixtureStartedMilliseconds",
      String(f.createdAt),
      "-ReadyPath",
      ready,
      "-ControlPath",
      control,
      "-ReplyPath",
      reply,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let closed = false;
  let code;
  let output = "";
  child.stdout.on("data", (bytes) => {
    output += bytes.toString();
  });
  child.stderr.on("data", (bytes) => {
    output += bytes.toString();
  });
  child.once("error", (error) => {
    output += error.message;
    closed = true;
  });
  child.once("close", (value) => {
    code = value;
    closed = true;
  });
  const send = (action) => {
    const nonce = randomUUID();
    writeFileSync(control + ".tmp", JSON.stringify({ nonce, action }));
    renameSync(control + ".tmp", control);
    return nonce;
  };
  const release = async () => {
    if (!closed) {
      send("release");
    }
    await waitFor(
      () => closed,
      "Supervisor hold helper did not release its retained handles",
      15000,
    );
    assert.equal(code, 0, output);
  };
  try {
    await waitFor(
      () => {
        assert.equal(
          closed,
          false,
          `Supervisor hold helper exited before readiness: ${output}`,
        );
        assert.equal(
          factory.closed,
          false,
          `Factory exited before the verifier became active: ${factory.stdout}\n${factory.stderr}`,
        );
        return existsSync(ready);
      },
      "Could not establish owned verifier supervisor hold",
      25000,
    );
  } catch (error) {
    await release();
    throw error;
  }
  const initial = JSON.parse(readFileSync(ready, "utf8"));
  assert.deepEqual(
    initial.processes.map((process) => process.role),
    ["supervisor", "verifier", "descendant"],
  );
  assert.ok(
    initial.processes.every((process) => process.alive),
    "Every retained fixture process must be alive when suspended",
  );
  return {
    initial,
    release,
    async terminateFactoryOnly() {
      assert.equal(closed, false, `Supervisor hold helper exited: ${output}`);
      const nonce = send("terminate-factory");
      await waitFor(
        () =>
          existsSync(reply) &&
          JSON.parse(readFileSync(reply, "utf8")).nonce === nonce,
        "Native factory termination did not respond",
        5000,
      );
      await waitFor(
        () => factory.closed,
        "Factory did not exit after native termination",
        10000,
      );
      await factory.done;
    },
    async probe() {
      assert.equal(closed, false, `Supervisor hold helper exited: ${output}`);
      const nonce = send("probe");
      await waitFor(
        () =>
          existsSync(reply) &&
          JSON.parse(readFileSync(reply, "utf8")).nonce === nonce,
        "Owned process liveness probe did not respond",
        5000,
      );
      const observed = JSON.parse(readFileSync(reply, "utf8"));
      for (const [index, process] of observed.processes.entries()) {
        assert.equal(process.pid, initial.processes[index].pid);
        assert.equal(process.createdAt, initial.processes[index].createdAt);
      }
      return observed.processes;
    },
  };
}
