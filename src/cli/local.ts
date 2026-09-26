import type { LocalCliResult } from "../contracts/local.js";

// BP-1 contract scaffold. PRODUCT-1 supplies local execution after behavioral red.
export async function runLocal(_path: string, _signal?: AbortSignal): Promise<LocalCliResult> {
  return { kind: "not_implemented" };
}
export async function checkEvidence(_path: string): Promise<LocalCliResult> {
  return { kind: "not_implemented" };
}
