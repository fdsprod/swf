import type { CliResult } from "../contracts/index.js";

const result: CliResult = { kind: "not_implemented" };
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = 3;
