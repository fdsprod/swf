import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import type { GitHubProgram } from "../contracts/delivery.js";
import type { Artifact } from "../contracts/local.js";
import { DurableError, type ErrorCode } from "./durable-store.js";
import { cleanEnvironment, processInJob } from "./windows-job.js";

export class GitHubApi {
  constructor(private readonly program: GitHubProgram, private readonly directory: string, private readonly errorCode: ErrorCode = "github_gateway_error") {}
  async request(method: "GET" | "POST", endpoint: string, options: { body?: unknown; paginate?: boolean } = {}): Promise<{ value: unknown; record: Artifact }> {
    try {
      await mkdir(this.directory, { recursive: true });
      const args = [...this.program.prefixArgs, "api", "--hostname", "github.com", "--method", method, endpoint, ...(options.paginate ? ["--paginate", "--slurp"] : []), ...(options.body === undefined ? [] : ["--input", "-"])];
      const environment = cleanEnvironment();
      delete environment.GH_DEBUG;
      for (const key of Object.keys(environment)) if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
      for (const key of ["GH_TOKEN", "GITHUB_TOKEN"]) if (process.env[key]) environment[key] = process.env[key];
      const processRecord = await processInJob({ executable: this.program.executable, args, cwd: this.directory, directory: this.directory, name: `github-${randomUUID()}`, timeoutSeconds: this.program.timeoutSeconds, trustedEnvironment: environment, ...(options.body === undefined ? {} : { input: JSON.stringify(options.body) }) });
      if (processRecord.termination.kind !== "exited" || processRecord.termination.exitCode !== 0) throw new Error(`GitHub request failed: ${JSON.stringify(processRecord.termination)}`);
      return { value: JSON.parse(await readFile(processRecord.stdout.path, "utf8")), record: processRecord.stdout };
    } catch (error) { throw new DurableError(this.errorCode, String(error)); }
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an API object");
  return value as Record<string, unknown>;
}
export function numberId(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("Expected positive API identity"); return Number(value); }
export function textValue(value: unknown): string { if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty API text"); return value; }
export function shaValue(value: unknown): string { const valueString = textValue(value); if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(valueString)) throw new Error("Invalid Git object identity"); return valueString; }
