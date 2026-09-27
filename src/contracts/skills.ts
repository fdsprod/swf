import type { Artifact } from "./local.js";

export type Assignment =
  | { role: "tester" | "designer" }
  | {
      role: "implementation";
      design: { kind: "none" } | { kind: "provided"; path: string };
    };
export interface Skills {
  assignment: Assignment;
  catalog: { id: string; root: string; entrypoint: string; assets: string[] }[];
  common: string[];
  byRole: { tester: string[]; designer: string[]; implementation: string[] };
}
export interface Instructions {
  assignment:
    | { role: "tester" | "designer" }
    | {
        role: "implementation";
        design:
          | { kind: "none" }
          | { kind: "provided"; artifact: Artifact; text: string };
      };
  skills: {
    id: string;
    entrypoint: Artifact;
    text: string;
    assets: Artifact[];
  }[];
}
