import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig, type Config } from "../src/config.js";
import {
  type Executor,
  type Handle,
  type Launch,
  type Thread,
} from "../src/executor.js";
import { parseFeature, withStatus } from "../src/features/documents.js";
import { Git } from "../src/git.js";
import { roadmap } from "../src/roadmap.js";
import { Store } from "../src/state-store.js";
import { dependencyBlockers } from "../src/workflow/dependencies.js";
import { type Job } from "../src/workflow/job.js";
import { Runner } from "../src/workflow/runner.js";
import { startJob } from "../src/workflow/start-job.js";
import { document } from "./fixtures.js";

const evidence = JSON.stringify({
  summary: "Implemented greeting",
  acceptance: [
    {
      criterion: "The greeting command prints hello.",
      evidence: "hello.test.ts passes",
    },
  ],
  validation: ["test passed"],
  responses: [],
});
const pass = JSON.stringify({
  verdict: "pass",
  findings: [],
  unmetAcceptanceCriteria: [],
  summary: "All acceptance criteria verified",
});
const changes = JSON.stringify({
  verdict: "changes_required",
  findings: [
    { description: "Wrong greeting", evidence: "hello.ts:1 prints goodbye" },
  ],
  unmetAcceptanceCriteria: ["hello"],
  summary: "Needs correction",
});
class Fake implements Executor {
  launches: Launch[] = [];
  sends = new Map<string, Handle>();
  threads = new Map<string, Thread>();
  titles = new Map<string, Handle>();
  review = pass;
  lose = false;
  running = false;
  constructor(public workspace: string) {}
  check = async () => {};
  close = async () => {};
  link = async () => {};
  find = async (title: string) => {
    return this.titles.has(title) ? [this.titles.get(title)!] : [];
  };
  launch = async (input: Launch) => {
    this.launches.push(input);
    const handle = {
      threadId: `thread-${this.launches.length}`,
      runId: `run-${this.launches.length}`,
    };
    this.titles.set(input.title, handle);
    this.threads.set(handle.threadId, {
      handle,
      status: this.running ? "running" : "completed",
      pending: false,
      workspace: this.workspace,
      branch: input.workspace.type === "root" ? null : input.workspace.branch,
      result: input.title.includes(":review:") ? this.review : evidence,
    });
    if (this.lose) {
      this.lose = false;
      throw new Error("response lost");
    }
    return handle;
  };
  send = async (h: Handle, _prompt: string, key: string) => {
    if (this.sends.has(key)) return this.sends.get(key)!;
    const handle = { ...h, runId: key };
    this.sends.set(key, handle);
    this.threads.set(h.threadId, {
      ...this.threads.get(h.threadId)!,
      handle,
      result: evidence,
    });
    return handle;
  };
  read = async (h: Handle) => {
    return this.threads.get(h.threadId)!;
  };
}
class FakeGit extends Git {
  tree = "tree1";
  published = 0;
  validation = 0;
  merged: "MERGED" | "OPEN" | "CLOSED" = "OPEN";
  mutateValidation = false;
  constructor() {
    super(async () => {
      this.validation++;
      if (this.mutateValidation) this.tree = "tree2";
      return { code: 0, stdout: "ok", stderr: "" };
    });
  }
  override binding = async () => {};
  override candidate = async () => {
    return this.tree;
  };
  override diff = async () => {
    return "diff --git hello.ts";
  };
  override cmd = async () => {
    return "base";
  };
  override prState = async () => {
    return this.merged;
  };
  override publish = async (j: Job, save: () => void) => {
    this.published++;
    j.publication.url = "https://github.com/test/repo/pull/1";
    save();
  };
}
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "flow-run-"));
  mkdirSync(join(root, "work"));
  const store = new Store(root),
    backend = new Fake(join(root, "work")),
    git = new FakeGit();
  const f = parseFeature(withStatus(parseFeature(document()), "ready"));
  store.approve(f.id, f.hash);
  const cfg: Config = {
    ...defaultConfig,
    validation: [{ name: "test", argv: ["node", "--test"], timeoutMs: 1000 }],
  };
  return {
    root,
    store,
    backend,
    git,
    f,
    cfg,
    clean: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
};
test("approved pipeline: fresh reviewer bound explicitly; validation before publication", async () => {
  const x = fixture();
  try {
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    await new Runner(x.root, x.store, x.backend, x.git).advance(j);
    assert.equal(j.stage, "pr_open");
    assert.equal(x.backend.launches.length, 2);
    assert.equal(x.backend.launches[1].workspace.type, "existing_worktree");
    assert.equal(x.git.validation, 1);
    assert.equal(x.git.published, 1);
    assert.equal(j.reviews[0].candidate, "tree1");
  } finally {
    x.clean();
  }
});
test("lost launch response reconciles without duplicate launch, after durable reload", async () => {
  const x = fixture();
  try {
    x.backend.lose = true;
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    const r = new Runner(x.root, x.store, x.backend, x.git);
    await r.advance(j);
    assert.equal(j.outcome, "failed");
    await r.advance(x.store.latest(x.f.id)!);
    assert.equal(x.backend.launches.length, 2);
    assert.equal(x.store.latest(x.f.id)!.stage, "pr_open");
  } finally {
    x.clean();
  }
});
test("uncertain launch with no visible match never retries blindly", async () => {
  const x = fixture();
  try {
    x.backend.lose = true;
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    const r = new Runner(x.root, x.store, x.backend, x.git);
    await r.advance(j);
    x.backend.titles.clear();
    await r.advance(j);
    assert.equal(j.outcome, "needs_input");
    assert.equal(x.backend.launches.length, 1);
  } finally {
    x.clean();
  }
});
test("malformed review and passing review with findings cannot publish", async () => {
  for (const review of [
    "not json",
    JSON.stringify({
      verdict: "pass",
      findings: [{ description: "bug", evidence: "line 1" }],
      unmetAcceptanceCriteria: [],
      summary: "bad pass",
    }),
  ]) {
    const x = fixture();
    try {
      x.backend.review = review;
      const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
      await new Runner(x.root, x.store, x.backend, x.git).advance(j);
      assert.equal(j.stage, "reviewing");
      assert.equal(j.outcome, "failed");
      assert.equal(x.git.published, 0);
    } finally {
      x.clean();
    }
  }
});
test("revision loop is bounded and each review is independent", async () => {
  const x = fixture();
  try {
    x.backend.review = changes;
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    await new Runner(x.root, x.store, x.backend, x.git).advance(j);
    assert.equal(j.outcome, "needs_input");
    assert.equal(j.revision, 2);
    assert.equal(j.reviews.length, 3);
    assert.equal(new Set(j.reviews.map((r) => r.handle.threadId)).size, 3);
    assert.equal(x.backend.sends.size, 2);
    assert.equal(x.git.published, 0);
  } finally {
    x.clean();
  }
});
test("validation mutations invalidate review and block publication", async () => {
  const x = fixture();
  try {
    x.git.mutateValidation = true;
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    await new Runner(x.root, x.store, x.backend, x.git).advance(j);
    assert.equal(j.stage, "validating");
    assert.equal(j.outcome, "needs_input");
    assert.equal(x.git.published, 0);
  } finally {
    x.clean();
  }
});
test("one active feature, meaningful validation required, approval mismatch", async () => {
  const x = fixture();
  try {
    await assert.rejects(
      startJob(
        { ...x.f, hash: "changed" },
        [x.f],
        x.cfg,
        x.store,
        x.git,
        x.root,
      ),
      /approval/,
    );
    await assert.rejects(
      startJob(
        x.f,
        [x.f],
        { ...x.cfg, validation: [] },
        x.store,
        x.git,
        x.root,
      ),
      /validation/,
    );
    await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    await assert.rejects(
      startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root),
      /already executing/,
    );
  } finally {
    x.clean();
  }
});
test("only confirmed merged PR satisfies prerequisite; deterministic sanitized export", async () => {
  const x = fixture();
  try {
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    j.stage = "pr_open";
    j.publication.url = "https://github.com/test/repo/pull/1";
    x.store.save(j);
    const dependent = parseFeature(document("next", "[hello]"));
    assert.equal(
      (await dependencyBlockers(dependent, x.store, x.git, x.root)).length,
      1,
    );
    x.git.merged = "MERGED";
    assert.deepEqual(
      await dependencyBlockers(dependent, x.store, x.git, x.root),
      [],
    );
    const a = JSON.stringify(
      await roadmap([dependent, x.f], x.store, x.git, x.root),
    );
    const b = JSON.stringify(
      await roadmap([x.f, dependent], x.store, x.git, x.root),
    );
    assert.equal(a, b);
    assert.ok(!a.includes(x.root));
    assert.ok(!a.includes(j.snapshot));
    assert.equal(JSON.parse(a).version, 1);
  } finally {
    x.clean();
  }
});
test("process lock blocks a live competing runner and releases", () => {
  const x = fixture();
  const second = new Store(x.root);
  try {
    const release = x.store.lock();
    assert.throws(() => second.lock(), /Another flow/);
    release();
    second.lock()();
  } finally {
    second.close();
    x.clean();
  }
});
test("interrupted validation requires confirmation before rerunning any commands", async () => {
  const x = fixture();
  try {
    const j = await startJob(x.f, [x.f], x.cfg, x.store, x.git, x.root);
    j.validationInFlight = "test";
    x.store.save(j);
    await new Runner(x.root, x.store, x.backend, x.git).advance(j);
    assert.equal(j.outcome, "needs_input");
    assert.equal(x.git.validation, 0);
    assert.equal(x.backend.launches.length, 0);
  } finally {
    x.clean();
  }
});
test("stale process lock is reclaimed after a crash", () => {
  const x = fixture();
  try {
    x.store.db
      .prepare("INSERT INTO process_lock VALUES (1,?,?,?)")
      .run(2147483647, requireHost(), "stale");
    x.store.lock()();
  } finally {
    x.clean();
  }
});
const requireHost = () => {
  return hostname();
};

test("human revision after exhausted rounds refreshes evidence and can pass a fresh review", async () => {
  const x = fixture();
  try {
    x.backend.review = changes;
    const j = await startJob(
      x.f,
      [x.f],
      { ...x.cfg, maxRevisions: 0 },
      x.store,
      x.git,
      x.root,
    );
    const runner = new Runner(x.root, x.store, x.backend, x.git);
    await runner.advance(j);
    assert.equal(j.outcome, "needs_input");
    const h = j.implementation!;
    x.backend.threads.set(h.threadId, {
      ...x.backend.threads.get(h.threadId)!,
      handle: { ...h, runId: "human-fix" },
      result: evidence,
    });
    x.backend.review = pass;
    x.git.tree = "fixed-tree";
    await runner.advance(j, { recheck: true });
    assert.equal(j.stage, "pr_open", j.error);
    assert.equal(j.implementation?.runId, "human-fix");
    assert.equal(j.reviews.length, 2);
    assert.equal(j.revision, 0);
  } finally {
    x.clean();
  }
});
