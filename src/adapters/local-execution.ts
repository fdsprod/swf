import { selectedSkills } from "./skills.js";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentOutcome, VerificationResult } from "../contracts/index.js";
import type { LocalConfig, ProcessRecord } from "../contracts/local.js";
import type { ProcessIdentity } from "../contracts/durable.js";
import { processInJob } from "./windows-job.js";
import { Ajv } from "ajv";
import decisionSchema from "../contracts/schemas/decision-wire.schema.json" with { type: "json" };
import type { DecisionWireResponse } from "../contracts/decisions.js";
const decisionWire = new Ajv().compile<DecisionWireResponse>(decisionSchema);
export interface DecisionAuthority {
  runId: string;
  unitId: string;
  attemptId: string;
}

export function commandResult(
  attemptId: string,
  specId: string,
  process: ProcessRecord,
): VerificationResult {
  return {
    specId,
    status:
      process.termination.kind !== "exited"
        ? "error"
        : process.termination.exitCode === 0
          ? "passed"
          : "failed",
    summary: JSON.stringify(process.termination),
    evidence: [
      {
        id: `${attemptId}:${specId}`,
        kind: "command_output",
        uri: process.stdout.path,
        digest: process.stdout.digest,
      },
    ],
  };
}

export function permissions(
  config: LocalConfig,
  workspace: string,
  commonGit: string,
): string {
  const rules: Record<string, string> = {
    ":root": "read",
    ":workspace_roots": "write",
  };
  rules[resolve(workspace).replaceAll("\\", "/")] = "write";
  for (const path of [
    commonGit,
    join(workspace, ".git"),
    ...config.protectedPaths.map((p) => join(workspace, p)),
  ]) {
    rules[resolve(path).replaceAll("\\", "/")] = "read";
  }
  if (config.skills) {
    for (const skill of selectedSkills(config.skills)) {
      for (const path of [skill.entrypoint, ...skill.assets]) {
        rules[resolve(skill.root, path).replaceAll("\\", "/")] = "read";
      }
    }
    const assignment = config.skills.assignment;
    if (
      assignment.role === "implementation" &&
      assignment.design.kind === "provided"
    ) {
      rules[resolve(assignment.design.path).replaceAll("\\", "/")] = "read";
    }
  }
  for (const path of config.blockedReadPaths) {
    rules[resolve(path).replaceAll("\\", "/")] = "deny";
  }
  return `permissions.factory.filesystem={${Object.entries(rules)
    .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
    .join(",")}}`;
}
export async function executeRestricted(
  config: LocalConfig,
  workspace: string,
  commonGit: string,
  directory: string,
  name: string,
  executable: string,
  args: string[],
  timeoutSeconds: number,
  signal?: AbortSignal,
  input?: string,
  nativeHost = false,
  cwd = workspace,
  onStarted?: (identity: ProcessIdentity) => Promise<void>,
): Promise<ProcessRecord> {
  const launchArgs = nativeHost
    ? args
    : [
        "sandbox",
        "-P",
        "factory",
        "-c",
        permissions(config, workspace, commonGit),
        "-c",
        "permissions.factory.network.enabled=false",
        "-C",
        cwd,
        "--",
        executable,
        ...args,
      ];
  const result = await processInJob({
    executable: nativeHost ? executable : config.sandboxExecutable,
    args: launchArgs,
    cwd,
    directory,
    name,
    timeoutSeconds,
    ...(signal ? { signal } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(onStarted ? { onStarted } : {}),
  });
  return { ...result, executable, args };
}
export function workerArgs(
  config: LocalConfig,
  workspace: string,
  commonGit: string,
  schema: string,
): string[] {
  return [
    ...config.worker.prefixArgs,
    "--no-daemon",
    "--ask-for-approval",
    "never",
    "exec",
    "--ignore-user-config",
    "-c",
    'windows.sandbox="elevated"',
    "-c",
    'default_permissions="factory"',
    "-c",
    permissions(config, workspace, commonGit),
    "-c",
    "permissions.factory.network.enabled=false",
    "-c",
    "mcp_servers={}",
    "--ephemeral",
    "--cd",
    workspace,
    "--json",
    "--color",
    "never",
    "--output-schema",
    schema,
    "-",
  ];
}
export async function outcome(
  record: ProcessRecord,
  authority?: DecisionAuthority,
): Promise<AgentOutcome> {
  const failed = (reason: string): AgentOutcome => ({
    kind: "failed",
    reason,
    evidence: [],
  });
  if (
    record.termination.kind !== "exited" ||
    record.termination.exitCode !== 0
  ) {
    return failed(
      `Worker process did not succeed: ${JSON.stringify(record.termination)}`,
    );
  }
  try {
    const lines = (await readFile(record.stdout.path, "utf8"))
      .trim()
      .split(/\r?\n/);
    let terminal = false;
    let message: unknown;
    for (const line of lines) {
      const event = JSON.parse(line) as {
        type?: string;
        item?: { type?: string; text?: string };
      };
      if (!event || typeof event.type !== "string" || terminal) {
        throw new Error("Invalid event or events after terminal outcome");
      }
      if (event.type === "error" || event.type === "turn.failed") {
        throw new Error("Worker reported a failed turn");
      }
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message"
      ) {
        message = event.item.text;
      }
      if (event.type === "turn.completed") {
        terminal = true;
      }
    }
    if (!terminal || typeof message !== "string") {
      throw new Error("Missing terminal structured outcome");
    }
    let wire = JSON.parse(message) as Record<string, unknown>;
    if (authority && wire && Object.hasOwn(wire, "outcome")) {
      if (!decisionWire(wire)) {
        throw new Error("Invalid decision wire response");
      }
      const nested = wire.outcome;
      if (nested.kind === "decision_required") {
        const d = nested.decision;
        if (
          !d.question.trim() ||
          !d.reason.trim() ||
          d.options.some((o) => !o.id.trim() || !o.description.trim()) ||
          new Set(d.options.map((o) => o.id)).size !== d.options.length
        ) {
          throw new Error("Invalid decision question or options");
        }
        return {
          kind: "decision_required",
          decision: {
            ...d,
            id: `${authority.runId}:decision:${authority.attemptId}`,
            runId: authority.runId,
            unitId: authority.unitId,
            evidence: [],
          },
        };
      }
      wire = { kind: nested.kind, message: nested.message };
    }
    if (
      !wire ||
      Object.keys(wire).sort().join(",") !== "kind,message" ||
      !["completed", "blocked", "failed"].includes(String(wire.kind)) ||
      typeof wire.message !== "string" ||
      !wire.message.trim()
    ) {
      throw new Error("Invalid structured outcome");
    }
    return wire.kind === "completed"
      ? { kind: "completed", summary: wire.message, evidence: [] }
      : {
          kind: wire.kind as "blocked" | "failed",
          reason: wire.message,
          evidence: [],
        };
  } catch (error) {
    return failed(`Invalid Codex response: ${String(error)}`);
  }
}
