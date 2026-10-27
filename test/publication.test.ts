import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../src/config.js";
import { Git, type PR } from "../src/git.js";
import { exec, type Exec } from "../src/process.js";
import { type Job } from "../src/workflow/job.js";

const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-publish-"));
  const cwd = join(root, "repo"),
    remote = join(root, "remote.git");
  mkdirSync(cwd);
  mkdirSync(remote);
  let creates = 0,
    lose = false,
    invisible = false;
  const prs: PR[] = [];
  const run: Exec = async (argv, dir, input, timeout) => {
    if (argv[0] !== "gh") return exec(argv, dir, input, timeout);
    if (argv[1] === "pr" && argv[2] === "list")
      return {
        code: 0,
        stdout: JSON.stringify(invisible ? [] : prs),
        stderr: "",
      };
    if (argv[1] === "pr" && argv[2] === "create") {
      creates++;
      const oid = (await exec(["git", "rev-parse", "HEAD"], cwd)).stdout.trim();
      prs.push({
        url: "https://github.com/fixture/repo/pull/1",
        state: "OPEN",
        isDraft: true,
        headRefOid: oid,
        headRefName: "flow/fixture",
        baseRefName: "main",
      });
      assert.ok(argv.includes("--draft"));
      assert.ok(input?.includes("Acceptance evidence"));
      assert.equal(argv[argv.indexOf("--body-file") + 1], "-");
      if (lose) throw new Error("lost gh response");
      return { code: 0, stdout: prs[0].url, stderr: "" };
    }
    throw new Error("Unexpected gh call: " + argv.join(" "));
  };
  const git = new Git(run);
  await git.cmd(remote, "init", "--bare");
  await git.cmd(cwd, "init", "-b", "main");
  await git.cmd(cwd, "config", "user.name", "Test");
  await git.cmd(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "file.txt"), "initial\n");
  await git.cmd(cwd, "add", ".");
  await git.cmd(cwd, "commit", "-m", "initial");
  const base = await git.cmd(cwd, "rev-parse", "HEAD");
  await git.cmd(cwd, "remote", "add", "origin", remote);
  await git.cmd(cwd, "checkout", "-b", "flow/fixture");
  writeFileSync(join(cwd, "file.txt"), "implemented\n");
  const candidate = await git.candidate(cwd);
  const j: Job = {
    id: "job1",
    featureId: "fixture",
    title: "Fixture",
    approvedHash: "hash",
    snapshot: "approved PRD",
    stage: "publishing",
    outcome: "active",
    config: {
      ...defaultConfig,
      validation: [{ name: "test", argv: ["node", "--test"], timeoutMs: 1000 }],
    },
    base,
    branch: "flow/fixture",
    workspace: cwd,
    operations: [],
    revision: 0,
    candidate,
    evidence: {
      summary: "Fixture scope",
      acceptance: [{ criterion: "works", evidence: "test passes" }],
      validation: [],
      responses: [],
    },
    reviews: [
      {
        candidate,
        handle: { threadId: "review" },
        result: {
          verdict: "pass",
          findings: [],
          unmetAcceptanceCriteria: [],
          summary: "Reviewed",
        },
      },
    ],
    validations: [
      {
        name: "test",
        argv: ["node", "--test"],
        code: 0,
        revision: candidate,
        stdout: "ok",
        stderr: "",
      },
    ],
    publication: {},
  };
  return {
    git,
    j,
    prs,
    get creates() {
      return creates;
    },
    lose: () => {
      lose = true;
    },
    hide: () => {
      invisible = true;
    },
    show: () => {
      invisible = false;
    },
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};
test("real Git commit/push to disposable remote; lost PR response is reconciled once", async () => {
  const x = await fixture();
  try {
    x.lose();
    await assert.rejects(
      x.git.publish(x.j, () => {}),
      /lost gh response/,
    );
    assert.equal(x.j.publication.attempted, true);
    assert.equal(x.creates, 1);
    await x.git.publish(x.j, () => {});
    assert.equal(x.creates, 1);
    assert.equal(x.j.publication.url, x.prs[0].url);
    assert.equal(
      (await x.git.cmd(x.j.workspace!, "rev-list", "--count", "HEAD")).trim(),
      "2",
    );
  } finally {
    x.cleanup();
  }
});
test("invisible uncertain PR is not created again without explicit retry", async () => {
  const x = await fixture();
  try {
    x.lose();
    await assert.rejects(x.git.publish(x.j, () => {}));
    x.hide();
    await assert.rejects(
      x.git.publish(x.j, () => {}),
      /uncertain/,
    );
    assert.equal(x.creates, 1);
  } finally {
    x.cleanup();
  }
});
test("publication requires review and validation for exact candidate", async () => {
  const x = await fixture();
  try {
    x.j.reviews[0].candidate = "old";
    await assert.rejects(
      x.git.publish(x.j, () => {}),
      /gates/,
    );
    x.j.reviews[0].candidate = x.j.candidate!;
    x.j.validations[0].revision = "old";
    await assert.rejects(
      x.git.publish(x.j, () => {}),
      /gates/,
    );
    assert.equal(x.creates, 0);
  } finally {
    x.cleanup();
  }
});
test("remote branch or existing PR mismatch is never overwritten", async () => {
  const x = await fixture();
  try {
    await x.git.cmd(
      x.j.workspace!,
      "push",
      "origin",
      `${x.j.base}:refs/heads/${x.j.branch}`,
    );
    await assert.rejects(
      x.git.publish(x.j, () => {}),
      /Remote branch differs/,
    );
    assert.equal(x.creates, 0);
  } finally {
    x.cleanup();
  }
});
