import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { GitHubIntake, GitHubRunConfig, RepositoryIdentity } from "../contracts/delivery.js";
import type { LocalConfig } from "../contracts/local.js";
import type { DurableProjection } from "../contracts/durable.js";
import { stable } from "../kernel/durable.js";
import { DurableError, validateStored } from "./durable-store.js";
import { GitHubApi, numberId, object, shaValue, textValue } from "./github-api.js";
import { prepareConfig } from "./local-config.js";
import { canonical } from "./local-files.js";
import { checkArtifact } from "./durable-execution.js";
import { prepareGit } from "./git-delivery.js";

export async function githubInput(value: unknown): Promise<GitHubRunConfig> {
  try {
    validateStored("github", value); const input = value as GitHubRunConfig;
    for (const path of [input.github.executable, input.git.executable, input.runtime.repositoryPath, input.runtime.workspaceRoot, input.runtime.artifactRoot]) { if (!isAbsolute(path)) throw new Error("Absolute program and directory paths required"); await canonical(path); }
    if (input.github.prefixArgs.some(a => a.startsWith("-"))) throw new Error("Gateway prefix arguments cannot contain options");
    if (!/^[A-Za-z0-9_.-]+$/.test(input.issue.owner) || !/^[A-Za-z0-9_.-]+$/.test(input.issue.repo)) throw new Error("Invalid repository locator");
    if (new Set(input.delivery.requiredChecks.map(c => stable([c.name, c.appId]))).size !== input.delivery.requiredChecks.length) throw new Error("Duplicate required check policy");
    return input;
  } catch (error) { throw new DurableError("input_error", String(error)); }
}
export function repositoryIdentity(raw: unknown): RepositoryIdentity {
  const r = object(raw), repository = { id: numberId(r.id), owner: textValue(object(r.owner).login), name: textValue(r.name), url: textValue(r.html_url) };
  if (!/^[A-Za-z0-9_.-]+$/.test(repository.owner) || !/^[A-Za-z0-9_.-]+$/.test(repository.name) || repository.url !== `https://github.com/${repository.owner}/${repository.name}` || r.clone_url !== `${repository.url}.git`) throw new DurableError("input_error", "Repository URL is not canonical github.com HTTPS");
  return repository;
}
function normalize(input: GitHubRunConfig, repositoryRaw: unknown, issueRaw: unknown, baseRaw: unknown): { config: LocalConfig; repository: RepositoryIdentity; issue: GitHubIntake["issue"]; base: GitHubIntake["base"] } {
  const repository = repositoryIdentity(repositoryRaw), issue = object(issueRaw), base = object(baseRaw);
  const issueId = numberId(issue.id), number = numberId(issue.number), url = textValue(issue.html_url), title = typeof issue.title === "string" ? issue.title : "";
  if (url !== `${repository.url}/issues/${number}`) throw new DurableError("input_error", "Issue URL is not canonical github.com HTTPS");
  const branch = textValue(base.name), sha = shaValue(object(base.commit).sha);
  if (repository.owner.toLowerCase() !== input.issue.owner.toLowerCase() || repository.name.toLowerCase() !== input.issue.repo.toLowerCase() || object(repositoryRaw).full_name !== `${repository.owner}/${repository.name}` || number !== input.issue.number || Object.hasOwn(issue, "pull_request") || !title.trim() || branch !== input.baseBranch || issue.repository_url !== `https://api.github.com/repos/${repository.owner}/${repository.name}`) throw new DurableError("input_error", "GitHub intake identities do not match the configured issue and base");
  if (issue.body !== null && issue.body !== undefined && typeof issue.body !== "string") throw new Error("Invalid issue body");
  const request = { id: `github:${repository.id}:issue:${issueId}`, source: { provider: "github", externalId: String(number), url }, repository: { url: `${repository.url}.git`, baseRef: input.baseBranch }, objective: `${title}\n\n${issue.body ?? ""}`, constraints: input.constraints, acceptanceCriteria: input.acceptanceCriteria, metadata: { githubRepositoryId: repository.id, githubIssueId: issueId } };
  const config: LocalConfig = { schemaVersion: 1, ...input.runtime, request, ...(input.repair ? { repair: input.repair } : {}), ...(input.decisions ? { decisions: { kind: "github_issue_comments", ...input.github, authorizedResolver: input.decisions.authorizedResolver } } : {}) };
  return { config, repository, issue: { id: issueId, number, url }, base: { branch, sha } };
}
export async function intakeGitHub(input: GitHubRunConfig, runId: string): Promise<{ prepared: Awaited<ReturnType<typeof prepareConfig>>; intake: GitHubIntake }> {
  const api = new GitHubApi(input.github, join(input.runtime.artifactRoot, runId, "intake")), prefix = `repos/${input.issue.owner}/${input.issue.repo}`;
  const repository = await api.request("GET", prefix), issue = await api.request("GET", `${prefix}/issues/${input.issue.number}`), base = await api.request("GET", `${prefix}/branches/${encodeURIComponent(input.baseBranch)}`);
  let normalized;
  try { normalized = normalize(input, repository.value, issue.value, base.value); }
  catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("github_gateway_error", String(error)); }
  const transport = await prepareGit(input, normalized.repository, runId, normalized.base.sha);
  let prepared;
  try { prepared = await prepareConfig(normalized.config); if (prepared.baseCommit !== normalized.base.sha) throw new Error("Local base differs from observed target base"); }
  catch (error) { throw new DurableError("input_error", String(error)); }
  return { prepared, intake: { input, repository: normalized.repository, issue: normalized.issue, base: normalized.base, transport, records: { repository: repository.record, issue: issue.record, base: base.record } } };
}
export async function auditIntake(p: DurableProjection): Promise<void> {
  if (!p.intake) return;
  const i = p.intake;
  for (const ref of Object.values(i.records)) await checkArtifact(ref);
  const values = await Promise.all([i.records.repository, i.records.issue, i.records.base].map(async ref => JSON.parse(await readFile(ref.path, "utf8")) as unknown));
  const normalized = normalize(i.input, values[0], values[1], values[2]);
  if (stable(normalized.config) !== stable(p.contract.config) || stable(normalized.repository) !== stable(i.repository) || stable(normalized.issue) !== stable(i.issue) || stable(normalized.base) !== stable(i.base) || i.base.sha !== p.baseCommit) throw new Error("Intake snapshot differs from run contract");
}
