import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Artifact, LocalConfig, LocalEvidence } from "../contracts/local.js";

export const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
export const within = (parent: string, child: string): boolean => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
export async function canonical(path: string): Promise<string> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Links are not allowed: ${path}`);
    const actual = await realpath(path);
    if (resolve(actual).toLowerCase() !== resolve(path).toLowerCase()) throw new Error(`Path traverses a link: ${path}`);
    return actual;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), relative(parent, path));
  }
}
export async function filePaths(root: string, skipGit = false): Promise<string[]> {
  const stat = await lstat(root);
  if (stat.isSymbolicLink()) throw new Error(`Links are not allowed: ${root}`);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) throw new Error(`Unsupported file: ${root}`);
  const paths: string[] = [];
  for (const name of (await readdir(root)).sort()) {
    if (skipGit && name === ".git") continue;
    paths.push(...await filePaths(join(root, name), false));
  }
  return paths;
}
export async function artifact(path: string): Promise<Artifact> { return { path, digest: hash(await readFile(path)) }; }
export async function save(path: string, data: string): Promise<Artifact> { await writeFile(path, data); return artifact(path); }
export async function snapshot(root: string): Promise<LocalEvidence["candidate"]> {
  const files = [];
  for (const path of await filePaths(root, true)) files.push({ path: relative(root, path).replaceAll("\\", "/"), digest: hash(await readFile(path)), mode: String((await lstat(path)).mode & 0o777) });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { digest: hash(JSON.stringify(files)), files };
}
export async function programs(config: LocalConfig, extra: string[] = []): Promise<Artifact[]> {
  const paths = new Set<string>([...extra, ...(config.decisions ? [config.decisions.executable] : []), config.worker.executable, config.sandboxExecutable, ...config.commands.map(c => c.executable)]);
  for (const root of config.verificationInputs) for (const path of await filePaths(root)) paths.add(path);
  const result: Artifact[] = [];
  for (const path of [...paths].sort()) result.push(await artifact(path));
  return result;
}
export const contractDigest = (config: LocalConfig, pinned: Artifact[]): string => hash(JSON.stringify({ config, programs: pinned }));
export function changes(before: LocalEvidence["candidate"], after: LocalEvidence["candidate"]): string[] {
  const a = new Map(before.files.map(f => [f.path, JSON.stringify(f)]));
  const b = new Map(after.files.map(f => [f.path, JSON.stringify(f)]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(path => a.get(path) !== b.get(path)).sort();
}

export async function captureDiff(workspace: string, baseCommit: string, path: string, before: LocalEvidence["candidate"], after: LocalEvidence["candidate"], changedPaths: string[], readPatch?: () => Promise<string>): Promise<{ artifact: Artifact; issues: string[] }> {
  const addedFiles: { path: string; encoding: string; content: string }[] = [];
  const issues: string[] = [];
  for (const file of after.files.filter(f => !before.files.some(b => b.path === f.path))) {
    try { addedFiles.push({ path: file.path, encoding: "base64", content: (await readFile(join(workspace, file.path))).toString("base64") }); }
    catch (error) { issues.push(`Cannot read added file ${file.path}: ${String(error)}`); }
  }
  let patch = "";
  try { patch = readPatch ? await readPatch() : git(workspace, "diff", "--binary", "--no-ext-diff", "--no-textconv", baseCommit, "--"); }
  catch (error) { issues.push(`Cannot read Git diff: ${String(error)}`); }
  return { artifact: await save(path, JSON.stringify({ patch, addedFiles, issues, before: before.files, after: after.files, changedPaths })), issues };
}
