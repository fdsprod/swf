import type { DurableCliResult } from "../contracts/durable.js";

export async function githubCommand(args: string[]): Promise<DurableCliResult> {
  const { durableCommand } = await import("./durable.js");
  return durableCommand(args);
}
