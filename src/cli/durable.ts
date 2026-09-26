import type { DurableCliResult } from "../contracts/durable.js";

// BP-2 contract scaffold. Product implementation follows committed behavioral red.
export async function durableCommand(_args: string[]): Promise<DurableCliResult> {
  return { kind: "not_implemented" };
}
