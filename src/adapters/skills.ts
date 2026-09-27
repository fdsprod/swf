import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import type { Artifact, LocalConfig } from "../contracts/local.js";
import type { Instructions, Skills } from "../contracts/skills.js";

export class SkillArtifactError extends Error {}

const key = (path: string): string => process.platform === "win32" ? path.toLowerCase() : path;
const contains = (root: string, path: string): boolean => {
  const rel = relative(key(resolve(root)), key(resolve(path)));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
};
export function selectedSkills(skills: Skills): Skills["catalog"] {
  const ids = new Set(skills.catalog.map(s => s.id));
  if (ids.size !== skills.catalog.length) throw new Error("Skill IDs must be unique");
  if (!skills.common.includes("ste")) throw new Error("Common skills must include ste");
  for (const id of [...skills.common, ...Object.values(skills.byRole).flat()]) if (!ids.has(id)) throw new Error(`Unknown skill: ${id}`);
  for (const s of skills.catalog) {
    if (!isAbsolute(s.root)) throw new Error("Skill roots must be absolute");
    for (const path of [s.entrypoint, ...s.assets]) {
      if (!path || isAbsolute(path) || win32.isAbsolute(path) || /[\\:\0]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error(`Invalid skill relative path: ${path}`);
    }
  }
  const a = skills.assignment;
  if (a.role === "implementation" && a.design.kind === "provided" && !isAbsolute(a.design.path)) throw new Error("Design path must be absolute");
  return [...new Set([...skills.common, ...skills.byRole[a.role], ...(a.role === "implementation" && a.design.kind === "none" ? skills.byRole.designer : [])])].map(id => skills.catalog.find(s => s.id === id)!);
}

export async function loadSkills(config: LocalConfig, pinned?: Artifact[]): Promise<{ instructions: Instructions; programs: Artifact[] } | undefined> {
  if (!config.skills) return undefined;
  const selected = selectedSkills(config.skills);
  const programs = new Map<string, Artifact>();
  let total = 0;
  const read = async (path: string, text: boolean): Promise<{ artifact: Artifact; text: string }> => {
    const absolute = resolve(path);
    const blocked = [config.repositoryPath, config.workspaceRoot, config.artifactRoot, ...config.blockedReadPaths];
    if (blocked.some(root => contains(root, absolute))) throw new Error(`Skill input is in a blocked location: ${path}`);
    for (let ancestor = absolute; ; ancestor = dirname(ancestor)) {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`Skill input traverses a link: ${path}`);
      if (dirname(ancestor) === ancestor) break;
    }
    const stat = await lstat(absolute);
    if (!stat.isFile()) throw new Error(`Skill input must be a regular file: ${path}`);
    if (text && (stat.size < 1 || stat.size > 65536)) throw new Error("Skill instruction text exceeds its byte limits");
    const canonical = await realpath(absolute);
    if (key(canonical) !== key(absolute) || blocked.some(root => contains(root, canonical))) throw new Error(`Unsafe skill input: ${path}`);
    const bytes = await readFile(canonical);
    const artifact = { path: canonical, digest: createHash("sha256").update(bytes).digest("hex") };
    if (pinned && !pinned.some(p => p.path === artifact.path && p.digest === artifact.digest)) throw new Error(`Pinned skill input changed: ${path}`);
    const previous = programs.get(key(canonical));
    if (previous && previous.digest !== artifact.digest) throw new Error(`Skill input changed while loading: ${path}`);
    programs.set(key(canonical), artifact);
    let decoded = "";
    if (text) {
      total += bytes.length;
      if (bytes.length < 1 || bytes.length > 65536 || total > 262144) throw new Error("Skill instruction text exceeds its byte limits");
      decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    return { artifact, text: decoded };
  };
  const skills: Instructions["skills"] = [];
  for (const s of selected) {
    const entry = await read(resolve(s.root, s.entrypoint), true);
    const assets: Artifact[] = [];
    for (const asset of s.assets) assets.push((await read(resolve(s.root, asset), false)).artifact);
    skills.push({ id: s.id, entrypoint: entry.artifact, text: entry.text, assets });
  }
  const a = config.skills.assignment;
  let assignment: Instructions["assignment"];
  if (a.role === "implementation" && a.design.kind === "provided") {
    const design = await read(a.design.path, true);
    assignment = { role: a.role, design: { kind: "provided", artifact: design.artifact, text: design.text } };
  } else if (a.role === "implementation") assignment = { role: a.role, design: { kind: "none" } };
  else assignment = { role: a.role };
  return { instructions: { assignment, skills }, programs: [...programs.values()] };
}
