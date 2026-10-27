import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Job } from "./workflow/job.js";
export class Store {
  db: DatabaseSync;
  constructor(root: string) {
    const dir = join(root, ".flow");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, "state.sqlite"));
    const version = this.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version > 1)
      throw new Error("State database was created by a newer flow version.");
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, feature TEXT NOT NULL, active INTEGER NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(active) WHERE active=1;
      CREATE TABLE IF NOT EXISTS process_lock(id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER, host TEXT, token TEXT);
      CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  close = () => {
    this.db.close();
  };
  approve = (id: string, hash: string) => {
    this.db
      .prepare("INSERT OR REPLACE INTO approvals VALUES (?,?)")
      .run(id, hash);
  };
  approval = (id: string): string | undefined => {
    return (
      this.db.prepare("SELECT hash FROM approvals WHERE id=?").get(id) as any
    )?.hash;
  };
  save = (j: Job) => {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES (?,?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM jobs)) ON CONFLICT(id) DO UPDATE SET active=excluded.active,data=excluded.data",
      )
      .run(
        j.id,
        j.featureId,
        j.stage !== "pr_open" && j.outcome !== "cancelled" ? 1 : 0,
        JSON.stringify(j),
      );
  };
  jobs = (): Job[] => {
    return (
      this.db.prepare("SELECT data FROM jobs ORDER BY seq").all() as {
        data: string;
      }[]
    ).map((x) => JSON.parse(x.data));
  };
  latest = (id: string) => {
    return this.jobs()
      .filter((j) => j.featureId === id)
      .at(-1);
  };
  active = () => {
    return this.jobs().find(
      (j) => j.stage !== "pr_open" && j.outcome !== "cancelled",
    );
  };
  draft = (id: string, data?: unknown): any => {
    if (data !== undefined)
      this.db
        .prepare("INSERT OR REPLACE INTO drafts VALUES (?,?)")
        .run(id, JSON.stringify(data));
    const row = this.db
      .prepare("SELECT data FROM drafts WHERE id=?")
      .get(id) as any;
    return row ? JSON.parse(row.data) : undefined;
  };
  drafts = (): { id: string; [key: string]: any }[] => {
    return (
      this.db.prepare("SELECT data FROM drafts ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data));
  };
  lock = (): (() => void) => {
    const token = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT * FROM process_lock WHERE id=1")
        .get() as any;
      if (row) {
        let alive = true;
        try {
          process.kill(row.pid, 0);
        } catch (e: any) {
          if (e.code === "ESRCH") alive = false;
        }
        if (row.host !== hostname() || alive)
          throw new Error(
            `Another flow process holds this repository (PID ${row.pid}).`,
          );
      }
      this.db
        .prepare("INSERT OR REPLACE INTO process_lock VALUES (1,?,?,?)")
        .run(process.pid, hostname(), token);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return () => {
      this.db.prepare("DELETE FROM process_lock WHERE token=?").run(token);
    };
  };
}
