import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Ajv } from "ajv";
import type { DurableEvent, DurableFact, DurableProjection, WorkerCompletion } from "../contracts/durable.js";
import type { LocalEvidence } from "../contracts/local.js";
import { replay, stable } from "../kernel/durable.js";
import fixtureSchema from "../contracts/schemas/run-fixture.schema.json" with { type: "json" };
import resultSchema from "../contracts/schemas/cli-result.schema.json" with { type: "json" };
import configSchema from "../contracts/schemas/local-config.schema.json" with { type: "json" };
import localSchema from "../contracts/schemas/local-result.schema.json" with { type: "json" };
import evidenceSchema from "../contracts/schemas/local-evidence.schema.json" with { type: "json" };
import durableSchema from "../contracts/schemas/durable-result.schema.json" with { type: "json" };

export type ErrorCode = "input_error" | "store_busy" | "not_found" | "config_mismatch" | "corrupt_store" | "artifact_invalid" | "ownership_uncertain";
export class DurableError extends Error { constructor(public readonly code: ErrorCode, message: string) { super(message); } }
const ajv = new Ajv({ allErrors: true });
for (const schema of [fixtureSchema, resultSchema, configSchema, localSchema, evidenceSchema, durableSchema]) ajv.addSchema(schema);
const validators = {
  event: ajv.compile<DurableEvent>({ $ref: `${durableSchema.$id}#/definitions/event` }),
  projection: ajv.compile<DurableProjection>({ $ref: `${durableSchema.$id}#/definitions/projection` }),
  completion: ajv.compile<WorkerCompletion>({ $ref: `${durableSchema.$id}#/definitions/workerCompletion` }),
  evidence: ajv.getSchema<LocalEvidence>(evidenceSchema.$id)!,
};
export function validateStored(kind: keyof typeof validators, value: unknown): void {
  const validate = validators[kind]; if (!validate(value)) throw new Error(`Invalid ${kind}: ${ajv.errorsText(validate.errors)}`);
}
export async function exists(path: string): Promise<boolean> { try { await readFile(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
export async function storePath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const parent = dirname(absolute); if (parent === absolute) throw new Error("Cannot resolve store path");
  return join(await storePath(parent), absolute.slice(parent.length).replace(/^[/\\]+/, ""));
}
export async function atomicWrite(path: string, data: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(data)); await rename(temp, path);
}
const points = ["transaction.after_event_insert", "transaction.after_projection_write", "transaction.after_commit", "workspace.after_create", "worker.after_dispatch", "worker.after_completion_artifact", "verification.after_dispatch", "verification.after_command", "verification.after_evidence_artifact"];
export class Faults {
  private hook?: { point: string; eventType?: string; marker: string };
  constructor() {
    if (!process.env.SWF_TEST_FAULT) return;
    try {
      const hook: unknown = JSON.parse(process.env.SWF_TEST_FAULT);
      if (!hook || typeof hook !== "object" || Array.isArray(hook)) throw new Error("Expected object");
      const h = hook as Record<string, unknown>;
      if (Object.keys(h).some(k => !["point", "eventType", "marker"].includes(k)) || typeof h.point !== "string" || !points.includes(h.point) || typeof h.marker !== "string" || !isAbsolute(h.marker) || (h.eventType !== undefined && typeof h.eventType !== "string")) throw new Error("Invalid fault boundary");
      this.hook = { point: h.point, marker: h.marker, ...(typeof h.eventType === "string" ? { eventType: h.eventType } : {}) };
    } catch (error) { throw new DurableError("input_error", `Invalid SWF_TEST_FAULT: ${String(error)}`); }
  }
  async at(point: string, runId: string, eventType?: string): Promise<void> {
    if (!this.hook || this.hook.point !== point || (this.hook.eventType && this.hook.eventType !== eventType)) return;
    await atomicWrite(this.hook.marker, { point, runId, ...(eventType ? { eventType } : {}) });
    await new Promise<void>(() => { setInterval(() => {}, 60000); });
  }
}
function configure(db: DatabaseSync): void {
  db.exec("PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
  if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "wal" || db.prepare("PRAGMA synchronous").get()?.synchronous !== 2) throw new Error("SQLite durability settings unavailable");
}
export class Store {
  private constructor(private readonly db: DatabaseSync, private readonly owner: DatabaseSync | undefined, readonly faults: Faults) {}
  static async open(path: string, writing: boolean, faults: Faults): Promise<Store> {
    let owner: DatabaseSync | undefined;
    try {
      if (writing) {
        await mkdir(path, { recursive: true }); owner = new DatabaseSync(join(path, "owner.sqlite"));
        try { owner.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE"); } catch (error) { throw new DurableError("store_busy", `Store has another runner: ${String(error)}`); }
      }
      const db = new DatabaseSync(join(path, "run.sqlite"), { readOnly: !writing });
      if (writing) {
        configure(db);
        db.exec("CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY, run_id TEXT NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projection(id INTEGER PRIMARY KEY CHECK(id=1), sequence INTEGER NOT NULL, json TEXT NOT NULL); CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END; CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;");
        db.exec("CREATE TRIGGER IF NOT EXISTS events_no_replace BEFORE INSERT ON events WHEN EXISTS(SELECT 1 FROM events WHERE sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;");
      }
      return new Store(db, owner, faults);
    } catch (error) { owner?.close(); throw error; }
  }
  close(): void { this.db.close(); this.owner?.close(); }
  read(): { events: DurableEvent[]; projection?: DurableProjection } {
    try {
      this.db.exec("BEGIN");
      const rows = this.db.prepare("SELECT sequence,run_id,json FROM events ORDER BY sequence").all();
      const projections = this.db.prepare("SELECT id,sequence,json FROM projection").all();
      const events = rows.map(row => {
        const event: unknown = JSON.parse(String(row.json)); validateStored("event", event); const e = event as DurableEvent;
        if (e.sequence !== row.sequence || e.runId !== row.run_id) throw new Error("Event envelope differs from row"); return e;
      });
      if (!events.length) { if (projections.length) throw new Error("Projection without events"); this.db.exec("COMMIT"); return { events }; }
      if (projections.length !== 1 || projections[0]!.id !== 1) throw new Error("Expected one projection");
      const row = projections[0]!, projection: unknown = JSON.parse(String(row.json)); validateStored("projection", projection);
      const derived = replay(events);
      if (row.sequence !== derived.sequence || stable(projection) !== stable(derived)) throw new Error("Projection disagrees with event replay");
      this.db.exec("COMMIT"); return { events, projection: derived };
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw new DurableError("corrupt_store", String(error)); }
  }
  async append(runId: string, fact: DurableFact): Promise<DurableProjection> {
    const prior = this.read(), event = { sequence: prior.events.length + 1, runId, fact };
    validateStored("event", event); const next = replay([...prior.events, event]); validateStored("projection", next);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO events(sequence,run_id,json) VALUES(?,?,?)").run(event.sequence, runId, JSON.stringify(event));
      await this.faults.at("transaction.after_event_insert", runId, fact.type);
      this.db.prepare("INSERT INTO projection(id,sequence,json) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,json=excluded.json").run(event.sequence, JSON.stringify(next));
      await this.faults.at("transaction.after_projection_write", runId, fact.type);
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
    await this.faults.at("transaction.after_commit", runId, fact.type); return next;
  }
}
