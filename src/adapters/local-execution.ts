import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentOutcome } from "../contracts/index.js";
import type { LocalConfig, ProcessRecord } from "../contracts/local.js";
import { processInJob } from "./windows-job.js";

export function permissions(config: LocalConfig, workspace: string, commonGit: string): string {
  const rules: Record<string, string> = { ":root": "read", ":workspace_roots": "write" };
  rules[resolve(workspace).replaceAll("\\", "/")] = "write";
  for (const path of [commonGit, join(workspace, ".git"), ...config.protectedPaths.map(p => join(workspace, p))]) rules[resolve(path).replaceAll("\\", "/")] = "read";
  for (const path of config.blockedReadPaths) rules[resolve(path).replaceAll("\\", "/")] = "deny";
  return `permissions.factory.filesystem={${Object.entries(rules).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(",")}}`;
}
export async function executeRestricted(config: LocalConfig, workspace: string, commonGit: string, directory: string, name: string, executable: string, args: string[], timeoutSeconds: number, signal?: AbortSignal, input?: string, nativeHost = false, cwd = workspace): Promise<ProcessRecord> {
  const launchArgs = nativeHost ? args : ["sandbox", "-P", "factory", "-c", permissions(config, workspace, commonGit), "-c", "permissions.factory.network.enabled=false", "-C", cwd, "--", executable, ...args];
  const result = await processInJob({ executable: nativeHost ? executable : config.sandboxExecutable, args: launchArgs, cwd, directory, name, timeoutSeconds, ...(signal ? { signal } : {}), ...(input !== undefined ? { input } : {}) });
  return { ...result, executable, args };
}
export function workerArgs(config: LocalConfig, workspace: string, commonGit: string, schema: string): string[] {
  return [...config.worker.prefixArgs, "--no-daemon", "--ask-for-approval", "never", "exec", "--ignore-user-config", "-c", 'windows.sandbox="elevated"', "-c", 'default_permissions="factory"', "-c", permissions(config, workspace, commonGit), "-c", "permissions.factory.network.enabled=false", "-c", "mcp_servers={}", "--ephemeral", "--cd", workspace, "--json", "--color", "never", "--output-schema", schema, "-"];
}
export async function outcome(record: ProcessRecord): Promise<AgentOutcome> {
  const failed = (reason: string): AgentOutcome => ({ kind: "failed", reason, evidence: [] });
  if (record.termination.kind !== "exited" || record.termination.exitCode !== 0) return failed(`Worker process did not succeed: ${JSON.stringify(record.termination)}`);
  try {
    const lines = (await readFile(record.stdout.path, "utf8")).trim().split(/\r?\n/);
    let terminal = false, message: unknown;
    for (const line of lines) {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (!event || typeof event.type !== "string" || terminal) throw new Error("Invalid event or events after terminal outcome");
      if (event.type === "error" || event.type === "turn.failed") throw new Error("Worker reported a failed turn");
      if (event.type === "item.completed" && event.item?.type === "agent_message") message = event.item.text;
      if (event.type === "turn.completed") terminal = true;
    }
    if (!terminal || typeof message !== "string") throw new Error("Missing terminal structured outcome");
    const wire = JSON.parse(message) as Record<string, unknown>;
    if (!wire || Object.keys(wire).sort().join(",") !== "kind,message" || !["completed", "blocked", "failed"].includes(String(wire.kind)) || typeof wire.message !== "string" || !wire.message.trim()) throw new Error("Invalid structured outcome");
    return wire.kind === "completed" ? { kind: "completed", summary: wire.message, evidence: [] } : { kind: wire.kind as "blocked" | "failed", reason: wire.message, evidence: [] };
  } catch (error) { return failed(`Invalid Codex response: ${String(error)}`); }
}
