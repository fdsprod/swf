import { Ajv, type ValidateFunction } from "ajv";
import fixtureSchema from "./schemas/run-fixture.schema.json" with { type: "json" };
import type { AgentOutcome, RunFixture, VerificationContract, VerificationResult } from "./index.js";

const ajv = new Ajv({ allErrors: true });
const fixtureValidator = ajv.compile<RunFixture>(fixtureSchema);
const definition = (name: string) => ({ $ref: `${fixtureSchema.$id}#/definitions/${name}` });
const contractValidator = ajv.compile<VerificationContract>(definition("verificationContract"));
const outcomeValidator = ajv.compile<AgentOutcome>(definition("agentOutcome"));
const resultsValidator = ajv.compile<VerificationResult[]>({ type: "array", items: definition("verificationResult") });

function issues(validate: ValidateFunction, value: unknown): string[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => `${error.instancePath || "/"} ${error.message}`);
}

export function verificationContractIssues(value: unknown): string[] {
  const errors = issues(contractValidator, value);
  if (errors.length) return errors;
  const contract = value as VerificationContract;
  const ids = contract.required.map(spec => spec.id);
  return new Set(ids).size === ids.length ? [] : ["Verification specification IDs must be unique"];
}

export function fixtureIssues(value: unknown): string[] {
  const errors = issues(fixtureValidator, value);
  return errors.length ? errors : verificationContractIssues((value as RunFixture).verification);
}

export function agentOutcomeIssues(value: unknown): string[] {
  return issues(outcomeValidator, value);
}

export function verificationResultsIssues(value: unknown): string[] {
  return issues(resultsValidator, value);
}
