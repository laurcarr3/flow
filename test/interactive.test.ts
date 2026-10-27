import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configure } from "../src/cli/configure.js";
import { choose, confirm } from "../src/cli/prompts.js";
import { recoveryOptions } from "../src/cli/recovery.js";
import { selectFeature } from "../src/cli/select-feature.js";
import { config } from "../src/config.js";
import { parseFeature, withStatus } from "../src/features/documents.js";
import { initialize } from "../src/init.js";
import { Store } from "../src/state-store.js";
import { type Job } from "../src/workflow/job.js";
import { document } from "./fixtures.js";

const answers = (...values: string[]) => {
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    assert.ok(values.length, `Unexpected prompt: ${prompt}`);
    return values.shift()!;
  };
  return { ask, prompts };
};
const job = (overrides: Partial<Job> = {}): Job => {
  return {
    id: "job",
    featureId: "hello",
    title: "Hello",
    approvedHash: "hash",
    snapshot: document(),
    stage: "reviewing",
    outcome: "needs_input",
    config: {
      version: 1,
      t3: {},
      validation: [],
      maxRevisions: 2,
      baseBranch: "main",
      remote: "origin",
    },
    base: "base",
    branch: "flow/hello",
    workspace: "/fixture",
    operations: [],
    revision: 0,
    reviews: [],
    validations: [],
    publication: {},
    ...overrides,
  };
};
test("menus accept numbers, names, defaults and back; confirmations require affirmative input", async () => {
  const a = answers("bad", "99", "2");
  assert.equal(
    await choose(a.ask, "Action", [
      { value: "new", label: "New" },
      { value: "run", label: "Run" },
    ]),
    "run",
  );
  assert.equal(
    await choose(
      answers("").ask,
      "Action",
      [{ value: "new", label: "New" }],
      "new",
    ),
    "new",
  );
  assert.equal(await choose(answers("q").ask, "Action", []), undefined);
  assert.equal(await confirm(answers("").ask, "Retry?"), false);
  assert.equal(await confirm(answers("maybe", "yes").ask, "Retry?"), true);
});
test("feature menu filters unapproved content and includes recovery for missing documents", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-menu-"));
  const store = new Store(root);
  try {
    const f = parseFeature(withStatus(parseFeature(document()), "ready"));
    await assert.rejects(
      selectFeature(answers().ask, "run", [f], store),
      /No approved/,
    );
    store.approve(f.id, f.hash);
    assert.equal(
      await selectFeature(answers("1").ask, "run", [f], store),
      "hello",
    );
    const changed = parseFeature(f.raw + "\n");
    await assert.rejects(
      selectFeature(answers().ask, "run", [changed], store),
      /No approved/,
    );
    store.save(job());
    assert.equal(
      await selectFeature(answers("1").ask, "resume", [], store),
      "hello",
    );
    assert.equal(
      await selectFeature(answers("q").ask, "cancel", [], store),
      undefined,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("recovery never authorizes uncertain retries without confirmation", async () => {
  const uncertain = job({
    stage: "preparing",
    operations: [
      {
        key: "impl",
        kind: "launch",
        attempted: true,
        title: "impl",
        prompt: "",
      },
    ],
  });
  assert.deepEqual(await recoveryOptions(answers("").ask, uncertain), {});
  assert.equal(
    await recoveryOptions(answers("launch", "").ask, uncertain),
    undefined,
  );
  assert.deepEqual(
    await recoveryOptions(answers("launch", "yes").ask, uncertain),
    { retryLaunch: true },
  );
  const publishing = job({
    stage: "publishing",
    publication: { attempted: true, pushed: true },
  });
  const prompts = answers("publish", "yes");
  assert.deepEqual(await recoveryOptions(prompts.ask, publishing), {
    retryPublish: true,
  });
  assert.doesNotMatch(prompts.prompts[0], /Review and validate again/);
  assert.deepEqual(await recoveryOptions(answers("recheck").ask, job()), {
    recheck: true,
  });
});
test("interrupted validation requires stopped-process confirmation and offers fresh review", async () => {
  const j = job({ stage: "validating", validationInFlight: "test" });
  assert.equal(await recoveryOptions(answers("", "no").ask, j), undefined);
  assert.deepEqual(await recoveryOptions(answers("", "yes", "yes").ask, j), {
    retryValidation: true,
    recheck: true,
  });
});
test("setup saves selected scripts and literal arguments only after confirmation", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-setup-"));
  try {
    initialize(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    const original = readFileSync(join(root, "flow.config.json"), "utf8");
    assert.equal(
      await configure(root, answers("", "", "", "done", "no").ask),
      false,
    );
    assert.equal(
      readFileSync(join(root, "flow.config.json"), "utf8"),
      original,
    );
    assert.equal(
      await configure(
        root,
        answers(
          "http://localhost:3000/mcp",
          "develop",
          "upstream",
          "script",
          "test",
          "npm",
          "custom",
          "lint",
          "tool",
          "$(touch BAD)",
          "two words",
          "",
          "done",
          "yes",
        ).ask,
      ),
      true,
    );
    const cfg = config(root);
    assert.equal(cfg.baseBranch, "develop");
    assert.deepEqual(
      cfg.validation.map((v) => v.argv),
      [
        ["npm", "run", "test"],
        ["tool", "$(touch BAD)", "two words"],
      ],
    );
    await assert.rejects(
      configure(root, answers("https://example.com/mcp?token=secret").ask),
      /without credentials/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
