import type { DurableCliResult } from "../contracts/durable.js";

export async function githubCommand(_args: string[]): Promise<DurableCliResult> {
  return { kind: "not_implemented" };
}
