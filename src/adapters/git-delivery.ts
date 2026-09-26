import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { DurableProjection } from "../contracts/durable.js";
import type { CommitReceipt, DeliveryPlan, DeliverySnapshot, DeliveryTransport, GitHubIntake, GitHubRunConfig, RepositoryIdentity } from "../contracts/delivery.js";
import type { Artifact, LocalEvidence, LocalWorkspace, ProcessRecord } from "../contracts/local.js";
import { stable } from "../kernel/durable.js";
import { artifact, canonical, hash, snapshot, within } from "./local-files.js";
import { DurableError } from "./durable-store.js";
import { cleanEnvironment, processInJob } from "./windows-job.js";

export type GitHubProjection = Extract<DurableProjection, { intake: GitHubIntake }>;
type TreeFile = { path: string; mode: "100644" | "100755"; oid: string };
type GitContext = { input: GitHubRunConfig; root: string; directory: string; stage: string; env: NodeJS.ProcessEnv; settings: string[]; args: string[]; common: string };
const contexts = new Map<string, Promise<GitContext>>();
function fail(message: string): never { throw new DurableError("delivery_error", message); }
function invalid(message: string): never { throw new DurableError("artifact_invalid", message); }
const sha = (value: string): string => /^[a-f0-9]{40}$/.test(value) ? value : fail("Unsupported Git object identity");
const success = (record: ProcessRecord): boolean => record.termination.kind === "exited" && record.termination.exitCode === 0;
const output = async (record: ProcessRecord): Promise<string> => (await readFile(record.stdout.path, "utf8")).trim();
const quote = (value: string): string => "'" + value.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'";
async function checkArtifact(ref: Artifact): Promise<void> {
  if ((await artifact(ref.path)).digest !== ref.digest) invalid("Artifact changed: " + ref.path);
}

function safePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes("\\") || path.includes("\0") || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) fail("Unsupported delivery file path");
}
function environment(empty: string): NodeJS.ProcessEnv {
  const env = cleanEnvironment();
  for (const key of Object.keys(env)) if (/^(GIT_|GH_|GITHUB_|SSH_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(key)) delete env[key];
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: empty, GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1" };
}
async function invoke(c: GitContext, args: string[], options: { raw?: boolean; input?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {}): Promise<ProcessRecord> {
  const record = await processInJob({ executable: c.input.git.executable, args: [...(options.raw ? c.settings : c.args), ...args], cwd: c.root, directory: c.root, name: "git-" + randomUUID(), timeoutSeconds: c.input.git.timeoutSeconds, trustedEnvironment: { ...c.env, ...options.env }, ...(options.input === undefined ? {} : { input: options.input }) });
  if (!options.allowFailure && !success(record)) fail(`Git command ${args[0]} failed (${JSON.stringify(record.termination)})`);
  return record;
}
async function context(input: GitHubRunConfig, runId: string): Promise<GitContext> {
  const key = stable([input, runId]);
  let pending = contexts.get(key);
  if (!pending) {
    pending = (async () => {
      const root = join(input.runtime.artifactRoot, runId, "git", randomUUID()), directory = join(root, "controlled.git"), stage = join(root, "stage"), empty = join(root, "empty"), hooks = join(root, "hooks");
      await mkdir(stage, { recursive: true }); await mkdir(hooks); await writeFile(empty, "");
      const settings = ["-c", "core.autocrlf=false", "-c", "core.filemode=false", "-c", "core.fsmonitor=false", "-c", "core.attributesFile=" + empty, "-c", "core.hooksPath=" + hooks, "-c", "credential.helper=", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", "-c", "http.followRedirects=false", "-c", "protocol.ext.allow=never"];
      const c: GitContext = { input, root, directory, stage, settings, args: [], env: environment(empty), common: "" };
      const common = await output(await invoke(c, ["-C", input.runtime.repositoryPath, "rev-parse", "--path-format=absolute", "--git-common-dir"], { raw: true }));
      c.common = await canonical(common);
      await invoke(c, ["init", "--bare", "--template=", directory], { raw: true });
      c.args = ["--git-dir=" + directory, "--work-tree=" + stage, ...settings];
      c.env.GIT_OBJECT_DIRECTORY = await canonical(join(c.common, "objects"));
      c.env.GIT_INDEX_FILE = join(root, "private.index");
      return c;
    })();
    contexts.set(key, pending);
  }
  return pending;
}
function destination(repository: RepositoryIdentity): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(repository.owner) || !/^[A-Za-z0-9_.-]+$/.test(repository.name) || repository.url !== `https://github.com/${repository.owner}/${repository.name}`) fail("Repository does not have a canonical GitHub identity");
  return repository.url + ".git";
}
export async function prepareGit(input: GitHubRunConfig, repository: RepositoryIdentity, runId: string, expectedBase: string): Promise<DeliveryTransport> {
  const c = await context(input, runId), url = destination(repository);
  const localHead = await output(await invoke(c, ["-C", input.runtime.repositoryPath, "rev-parse", "--verify", "--end-of-options", input.baseBranch + "^{commit}"], { raw: true }));
  if (localHead !== sha(expectedBase)) throw new DurableError("input_error", "Local base differs from the observed target base");
  await invoke(c, ["cat-file", "-e", expectedBase + "^{commit}"]);
  await basePolicy(c, expectedBase, []);
  if (input.delivery.transport.kind === "github_https") return { kind: "github_https", url };
  const path = await canonical(resolve(input.delivery.transport.path));
  if (!(await lstat(path)).isDirectory()) throw new DurableError("input_error", "Local delivery transport must be a bare directory");
  // This read cannot invoke source hooks or helpers; transport commands later use the controlled repository.
  const bare = await output(await invoke(c, ["--git-dir=" + path, "rev-parse", "--is-bare-repository"], { raw: true }));
  if (bare !== "true") throw new DurableError("input_error", "Local delivery transport must be bare");
  return { kind: "local_bare", path };
}
function treeFiles(bytes: Buffer): TreeFile[] {
  if (!Buffer.from(bytes.toString("utf8")).equals(bytes)) fail("Git tree contains unsupported filename encoding");
  const result: TreeFile[] = [];
  for (const line of bytes.toString("utf8").split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t"), fields = line.slice(0, tab).split(" "), path = line.slice(tab + 1);
    if (tab < 0 || fields.length !== 3 || fields[1] !== "blob" || (fields[0] !== "100644" && fields[0] !== "100755")) fail("Delivery supports regular Git files only");
    safePath(path); result.push({ path, mode: fields[0], oid: sha(fields[2]!) });
  }
  return result;
}
async function tree(c: GitContext, id: string): Promise<TreeFile[]> { return treeFiles(await readFile((await invoke(c, ["ls-tree", "-rz", "--full-tree", sha(id)])).stdout.path)); }
export async function createGitWorkspace(p: GitHubProjection, workspace: LocalWorkspace): Promise<void> {
  if (workspace.baseCommit !== p.baseCommit || workspace.repositoryPath !== p.contract.config.repositoryPath) invalid("Worktree differs from the pinned repository and base");
  const c = await context(p.intake.input, p.runId);
  await basePolicy(c, p.baseCommit, []);
  await mkdir(dirname(workspace.path), { recursive: true });
  // Registration uses the source repository, but no delivery credentials or Git callbacks.
  // Git must create the linked worktree's own index instead of our private staging index.
  await invoke(c, ["-C", workspace.repositoryPath, "--attr-source=" + p.baseCommit, "worktree", "add", "--detach", workspace.path, p.baseCommit], { raw: true, env: { GIT_INDEX_FILE: undefined, GIT_OBJECT_DIRECTORY: undefined } });
}
export async function gitBaseSnapshot(p: GitHubProjection): Promise<LocalEvidence["candidate"]> {
  const c = await context(p.intake.input, p.runId), files: LocalEvidence["candidate"]["files"] = [];
  for (const file of await tree(c, p.baseCommit)) {
    const record = await invoke(c, ["--attr-source=" + p.baseCommit, "cat-file", "--filters", p.baseCommit + ":" + file.path]);
    files.push({ path: file.path, digest: hash(await readFile(record.stdout.path)), mode: String(process.platform === "win32" ? 0o666 : file.mode === "100755" ? 0o755 : 0o644) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { digest: hash(JSON.stringify(files)), files };
}
export async function gitCandidateDiff(p: GitHubProjection): Promise<string> {
  if (p.workspace.kind !== "ready") invalid("Diff capture requires the recorded workspace");
  const c = await context(p.intake.input, p.runId);
  // Verification can reach this before any delivery plan has populated the private index.
  await invoke(c, ["read-tree", p.baseCommit]);
  return output(await invoke(c, ["--work-tree=" + p.workspace.workspace.path, "--attr-source=" + p.baseCommit, "diff", "--binary", "--no-ext-diff", "--no-textconv", p.baseCommit, "--"]));
}
async function basePolicy(c: GitContext, base: string, candidatePaths: string[]): Promise<TreeFile[]> {
  try { if ((await readFile(join(c.common, "info", "attributes"))).length) fail("Repository info attributes are unsupported for delivery"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const baseFiles = await tree(c, base), paths = [...new Set([...baseFiles.map(f => f.path), ...candidatePaths])];
  paths.forEach(safePath);
  const attrs = await readFile((await invoke(c, ["--attr-source=" + base, "check-attr", "--all", "-z", "--stdin"], { input: paths.join("\0") + "\0" })).stdout.path, "utf8");
  const fields = attrs.split("\0");
  for (let i = 0; i + 2 < fields.length; i += 3) if (fields[i + 1] === "filter" && fields[i + 2] !== "unset" && fields[i + 2] !== "unspecified") fail("Custom Git filters are unsupported for delivery");
  return baseFiles;
}
async function representationPolicy(c: GitContext, base: string, candidate: LocalEvidence["candidate"], workspace: string): Promise<TreeFile[]> {
  const baseFiles = await basePolicy(c, base, candidate.files.map(f => f.path)), paths = [...new Set([...baseFiles.map(f => f.path), ...candidate.files.map(f => f.path)])];
  for (const path of paths.filter(path => basename(path) === ".gitattributes")) {
    const old = baseFiles.find(f => f.path === path), current = candidate.files.find(f => f.path === path);
    if (!old || !current) fail("Changed attributes are unsupported for delivery");
    const bytes = await readFile((await invoke(c, ["--attr-source=" + base, "cat-file", "--filters", base + ":" + path])).stdout.path);
    if (hash(bytes) !== current.digest || hash(await readFile(join(workspace, path))) !== current.digest) fail("Changed attributes are unsupported for delivery");
  }
  return baseFiles;
}
function identity(value: { name: string; email: string }): void {
  if (!value.name.trim() || !value.email.trim() || /[\r\n<>\0]/.test(value.name + value.email) || value.name !== value.name.trim() || value.email !== value.email.trim()) fail("Unsupported Git commit identity");
}
async function commitBytes(plan: DeliveryPlan): Promise<Buffer> {
  const c = plan.commit; identity(c.author); identity(c.committer);
  if (!/^\d+ \+0000$/.test(c.author.date) || !/^\d+ \+0000$/.test(c.committer.date)) invalid("Invalid pinned commit date");
  const message = await readFile(c.message.path);
  return Buffer.concat([Buffer.from(`tree ${sha(c.tree)}\nparent ${sha(c.parent)}\nauthor ${c.author.name} <${c.author.email}> ${c.author.date}\ncommitter ${c.committer.name} <${c.committer.email}> ${c.committer.date}\n\n`), message]);
}
const commitHash = (bytes: Buffer): string => createHash("sha1").update(Buffer.from(`commit ${bytes.length}\0`)).update(bytes).digest("hex");
function authority(p: GitHubProjection, plan: DeliveryPlan): void {
  if (plan.baseCommit !== p.baseCommit || plan.commit.parent !== p.baseCommit || stable(plan.repository) !== stable(p.intake.repository) || stable(plan.transport) !== stable(p.intake.transport) || plan.branch !== "swf/" + hash(p.runId) || p.verification.kind !== "completed" || plan.verificationId !== p.verification.operationId || stable(plan.evidence) !== stable(p.verification.evidence)) invalid("Delivery plan differs from the recorded run authority");
  if (plan.transport.kind === "github_https" && plan.transport.url !== destination(p.intake.repository)) invalid("Delivery destination changed");
  if (stable({ name: plan.commit.author.name, email: plan.commit.author.email }) !== stable(p.intake.input.delivery.commitIdentity) || stable(plan.commit.author) !== stable(plan.commit.committer)) invalid("Delivery commit identity changed");
}
async function loadSnapshot(p: GitHubProjection, plan: DeliveryPlan): Promise<DeliverySnapshot> {
  authority(p, plan);
  await checkArtifact(plan.evidence); await checkArtifact(plan.snapshot); await checkArtifact(plan.commit.message);
  const evidence = JSON.parse(await readFile(plan.evidence.path, "utf8")) as LocalEvidence;
  const value = JSON.parse(await readFile(plan.snapshot.path, "utf8")) as DeliverySnapshot;
  if (value.schemaVersion !== 1 || !Array.isArray(value.files) || plan.candidateDigest !== evidence.candidate.digest || value.files.length !== evidence.candidate.files.length || new Set(value.files.map(f => f.path)).size !== value.files.length) invalid("Delivery snapshot does not cover the verified candidate");
  for (const file of value.files) {
    safePath(file.path);
    const expected = evidence.candidate.files.find(f => f.path === file.path);
    if (!expected || expected.digest !== file.digest || file.content.digest !== file.digest || !["100644", "100755"].includes(file.mode)) invalid("Delivery snapshot differs from verified content");
    await checkArtifact(file.content);
  }
  if (commitHash(await commitBytes(plan)) !== plan.commit.expectedSha) invalid("Pinned commit bytes do not match their identity");
  return value;
}
async function checkTree(c: GitContext, id: string, files: DeliverySnapshot["files"]): Promise<void> {
  const actual = await tree(c, id), expected = files.map(({ path, mode }) => ({ path, mode }));
  const sorted = (items: { path: string; mode: string }[]) => items.map(({ path, mode }) => ({ path, mode })).sort((a, b) => a.path.localeCompare(b.path));
  if (stable(sorted(actual)) !== stable(sorted(expected))) fail("Produced tree has different files or Git modes");
  for (const file of files) {
    const record = await invoke(c, ["--attr-source=" + id, "cat-file", "--filters", id + ":" + file.path]);
    if (hash(await readFile(record.stdout.path)) !== file.digest) fail("Produced checkout differs from the verified candidate: " + file.path);
  }
}
export async function planDelivery(p: GitHubProjection, evidence: LocalEvidence, options: { operationId: string; date: string; message: string }): Promise<DeliveryPlan> {
  if (p.workspace.kind !== "ready" || p.verification.kind !== "completed" || p.state.status !== "VERIFIED" || evidence.verdict.status !== "VERIFIED" || !evidence.changedPaths.length) fail("Delivery requires a nonempty verified candidate");
  if (stable(await snapshot(p.workspace.workspace.path)) !== stable(evidence.candidate)) invalid("Candidate changed before delivery planning");
  const c = await context(p.intake.input, p.runId), baseFiles = await representationPolicy(c, p.baseCommit, evidence.candidate, p.workspace.workspace.path);
  const root = join(p.contract.config.artifactRoot, p.runId, "delivery", options.operationId); await mkdir(root, { recursive: true });
  const snapshotValue: DeliverySnapshot = { schemaVersion: 1, files: [] };
  for (const file of evidence.candidate.files) {
    safePath(file.path); const bytes = await readFile(join(p.workspace.workspace.path, file.path));
    if (hash(bytes) !== file.digest) invalid("Candidate changed during delivery planning");
    const path = join(root, hash(file.path) + ".content"); await writeFile(path, bytes, { flag: "wx" });
    snapshotValue.files.push({ path: file.path, digest: file.digest, mode: baseFiles.find(f => f.path === file.path)?.mode ?? "100644", content: await artifact(path) });
    const target = join(c.stage, file.path); if (!within(c.stage, target)) fail("Invalid staging path");
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  const paths = [...new Set([...baseFiles.map(f => f.path), ...snapshotValue.files.map(f => f.path)])];
  const pathspec = join(c.root, "paths-" + randomUUID()); await writeFile(pathspec, paths.join("\0") + "\0");
  await invoke(c, ["read-tree", p.baseCommit]);
  await invoke(c, ["--attr-source=" + p.baseCommit, "add", "-A", "-f", "--pathspec-from-file=" + pathspec, "--pathspec-file-nul"]);
  const treeId = sha(await output(await invoke(c, ["write-tree"])));
  await checkTree(c, treeId, snapshotValue.files);
  const baseTree = await output(await invoke(c, ["rev-parse", p.baseCommit + "^{tree}"]));
  if (treeId === baseTree) fail("Delivery commit would contain no change");
  const snapshotPath = join(root, "snapshot.json"), messagePath = join(root, "message.txt");
  await writeFile(snapshotPath, JSON.stringify(snapshotValue), { flag: "wx" });
  // commit-tree appends a final newline; pin that exact representation before any commit object exists.
  const message = options.message.endsWith("\n") ? options.message : options.message + "\n";
  await writeFile(messagePath, message, { flag: "wx" });
  const author = { ...p.intake.input.delivery.commitIdentity, date: options.date };
  const plan: DeliveryPlan = { operationId: options.operationId, verificationId: p.verification.operationId, evidence: p.verification.evidence, candidateDigest: evidence.candidate.digest, baseCommit: p.baseCommit, repository: p.intake.repository, transport: p.intake.transport, branch: "swf/" + hash(p.runId), snapshot: await artifact(snapshotPath), commit: { tree: treeId, parent: p.baseCommit, author, committer: { ...author }, message: await artifact(messagePath), expectedSha: "" } };
  plan.commit.expectedSha = commitHash(await commitBytes(plan)); return plan;
}
export async function auditDeliveryPlan(p: GitHubProjection, plan: DeliveryPlan): Promise<void> {
  try {
    const value = await loadSnapshot(p, plan), c = await context(p.intake.input, p.runId);
    const evidence = JSON.parse(await readFile(plan.evidence.path, "utf8")) as LocalEvidence;
    const base = await representationPolicy(c, p.baseCommit, evidence.candidate, evidence.workspace.path);
    for (const file of value.files) if (file.mode !== (base.find(f => f.path === file.path)?.mode ?? "100644")) invalid("Snapshot Git mode differs from its pinned base");
    await checkTree(c, plan.commit.tree, value.files);
  } catch (error) { if (error instanceof DurableError) throw error; throw new DurableError("artifact_invalid", String(error)); }
}
export async function createCommit(p: GitHubProjection, plan: DeliveryPlan): Promise<CommitReceipt> {
  const c = await context(p.intake.input, p.runId); await loadSnapshot(p, plan);
  const record = await invoke(c, ["commit-tree", plan.commit.tree, "-p", plan.commit.parent, "-F", "-"], { input: await readFile(plan.commit.message.path, "utf8"), env: { GIT_AUTHOR_NAME: plan.commit.author.name, GIT_AUTHOR_EMAIL: plan.commit.author.email, GIT_AUTHOR_DATE: plan.commit.author.date, GIT_COMMITTER_NAME: plan.commit.committer.name, GIT_COMMITTER_EMAIL: plan.commit.committer.email, GIT_COMMITTER_DATE: plan.commit.committer.date } });
  const actual = await output(record); if (actual !== plan.commit.expectedSha) fail("Git created an object different from the planned commit");
  const bytes = await readFile((await invoke(c, ["cat-file", "commit", actual])).stdout.path);
  if (!bytes.equals(await commitBytes(plan))) fail("Git commit representation differs from the pinned inputs");
  return { sha: actual, process: record };
}
function remoteOptions(p: GitHubProjection, plan: DeliveryPlan): { args: string[]; env: NodeJS.ProcessEnv; target: string } {
  authority(p, plan);
  if (plan.transport.kind === "local_bare") return { args: [], env: {}, target: plan.transport.path };
  const gateway = p.intake.input.github;
  const helper = "!" + [gateway.executable, ...gateway.prefixArgs, "auth", "git-credential"].map(quote).join(" ");
  return { args: ["-c", "credential.https://github.com.helper=" + helper, "-c", "credential.useHttpPath=true"], env: { ...(process.env.GH_TOKEN ? { GH_TOKEN: process.env.GH_TOKEN } : {}), ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}), ...(process.env.GH_CONFIG_DIR ? { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR } : {}) }, target: plan.transport.url };
}
export async function readRemoteRef(p: GitHubProjection, plan: DeliveryPlan): Promise<{ kind: "absent"; process: ProcessRecord } | { kind: "present"; sha: string; process: ProcessRecord }> {
  const c = await context(p.intake.input, p.runId), remote = remoteOptions(p, plan), ref = "refs/heads/" + plan.branch;
  const record = await invoke(c, [...remote.args, "ls-remote", "--exit-code", remote.target, ref], { env: remote.env, allowFailure: true }), text = await output(record);
  if (record.termination.kind === "exited" && record.termination.exitCode === 2 && !text) return { kind: "absent", process: record };
  if (!success(record)) fail("Cannot observe delivery ref");
  const lines = text.split(/\r?\n/), fields = lines[0]?.split("\t");
  if (lines.length !== 1 || fields?.length !== 2 || fields[1] !== ref) fail("Remote returned an ambiguous delivery ref");
  return { kind: "present", sha: sha(fields[0]!), process: record };
}
export async function pushCreateOnly(p: GitHubProjection, plan: DeliveryPlan): Promise<ProcessRecord> {
  const c = await context(p.intake.input, p.runId), remote = remoteOptions(p, plan), ref = "refs/heads/" + plan.branch;
  return invoke(c, [...remote.args, "push", "--porcelain", "--force-with-lease=" + ref + ":", remote.target, plan.commit.expectedSha + ":" + ref], { env: remote.env, allowFailure: true });
}
