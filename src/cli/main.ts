import { SkillArtifactError } from "../adapters/skills.js";
import { readFile } from "node:fs/promises";
import type { CliResult, RunFixture } from "../contracts/index.js";
import { fixtureIssues } from "../contracts/validation.js";
import { run } from "../kernel/index.js";
import { scriptedVerifier, scriptedWorker } from "../adapters/scripted.js";
import type { LocalCliResult } from "../contracts/local.js";
import { runLocal, checkEvidence } from "./local.js";
import type { DurableCliResult } from "../contracts/durable.js";

function inputError(issues: string[]): CliResult {
  return { kind: "input_error", issues, events: [] };
}

async function main(
  args: string[],
): Promise<CliResult | LocalCliResult | DurableCliResult> {
  if (args[0] === "run" && args[1] === "--github") {
    const { githubCommand } = await import("./github.js");
    return githubCommand(args);
  }
  if (
    args.includes("--store") ||
    args[0] === "resume" ||
    args[0] === "status"
  ) {
    const { durableCommand } = await import("./durable.js");
    return durableCommand(args);
  }
  if (args.length === 4 && args[2] && args[3] === "--json") {
    if (args[0] === "run" && args[1] === "--local") {
      return runLocal(args[2]);
    }
    if (args[0] === "check" && args[1] === "--evidence") {
      return checkEvidence(args[2]);
    }
  }
  if (
    args.length !== 4 ||
    args[0] !== "run" ||
    args[1] !== "--fixture" ||
    !args[2] ||
    args[3] !== "--json"
  ) {
    return inputError([
      "Usage: node dist/cli/main.js run --fixture <JSON file> --json",
    ]);
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(args[2], "utf8"));
  } catch (error) {
    return inputError([
      `Cannot read fixture JSON: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const issues = fixtureIssues(value);
  if (issues.length) {
    return inputError(issues);
  }
  const fixture = value as RunFixture;
  return run(
    fixture.request,
    fixture.verification,
    scriptedWorker(fixture.script.agentOutcome),
    scriptedVerifier(fixture.script.verificationResults),
  );
}

const result = await main(process.argv.slice(2)).catch(
  (error: unknown): DurableCliResult => {
    if (error instanceof SkillArtifactError) {
      return {
        kind: "durable_error",
        code: "artifact_invalid",
        issues: [error.message],
      };
    }
    throw error;
  },
);
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode =
  result.kind === "not_implemented"
    ? 3
    : result.kind === "durable_status"
      ? 0
      : result.kind === "durable_result"
        ? result.projection.state.status === "WAITING_FOR_DECISION"
          ? 0
          : result.projection.intake
            ? result.projection.delivery.kind === "created" &&
              result.projection.delivery.pullRequest.state.kind !== "closed" &&
              result.projection.ci.kind === "passed"
              ? 0
              : 1
            : result.projection.state.status === "VERIFIED"
              ? 0
              : 1
        : result.kind === "durable_error"
          ? result.code === "input_error"
            ? 2
            : 1
          : result.kind === "evidence_check"
            ? result.status === "current"
              ? 0
              : 1
            : result.kind === "run_result" || result.kind === "local_run_result"
              ? result.state.status === "VERIFIED"
                ? 0
                : 1
              : 2;
