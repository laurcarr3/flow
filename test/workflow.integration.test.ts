import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultConfig } from "../src/config.js";
import {
  type Executor,
  type Handle,
  type Launch,
  type Thread,
} from "../src/executor.js";
import { parseFeature, withStatus } from "../src/features/documents.js";
import { Git } from "../src/git.js";
import { exec } from "../src/process.js";
import { Store } from "../src/state-store.js";
import { Runner } from "../src/workflow/runner.js";
import { startJob } from "../src/workflow/start-job.js";
import { document } from "./fixtures.js";

test("end-to-end runner with real worktree, validation, commit, local push, and fake T3/GitHub", async () => {
  const temp = mkdtempSync(join(tmpdir(), "flow-e2e-")),
    root = join(temp, "repo"),
    remote = join(temp, "remote.git"),
    work = join(temp, "work");
  mkdirSync(root);
  mkdirSync(remote);
  const prs: unknown[] = [];
  let creates = 0,
    links = 0;
  const git = new Git(async (args, cwd, input, timeout) => {
    if (args[0] !== "gh") return exec(args, cwd, input, timeout);
    if (args[2] === "list")
      return { code: 0, stdout: JSON.stringify(prs), stderr: "" };
    assert.equal(args[2], "create");
    creates++;
    prs.push({
      url: "https://github.com/fixture/repo/pull/1",
      state: "OPEN",
      isDraft: true,
      headRefOid: await git.cmd(cwd, "rev-parse", "HEAD"),
      headRefName: args[args.indexOf("--head") + 1],
      baseRefName: "main",
    });
    return {
      code: 0,
      stdout: "https://github.com/fixture/repo/pull/1",
      stderr: "",
    };
  });
  let store: Store | undefined;
  try {
    await git.cmd(remote, "init", "--bare");
    await git.cmd(root, "init", "-b", "main");
    await git.cmd(root, "config", "user.name", "Test");
    await git.cmd(root, "config", "user.email", "test@example.invalid");
    writeFileSync(join(root, "README.md"), "Fixture\n");
    writeFileSync(join(root, ".gitignore"), ".flow/\n");
    await git.cmd(root, "add", ".");
    await git.cmd(root, "commit", "-m", "initial");
    await git.cmd(root, "remote", "add", "origin", remote);
    await git.cmd(root, "push", "origin", "main");
    store = new Store(root);
    const f = parseFeature(withStatus(parseFeature(document()), "ready"));
    store.approve(f.id, f.hash);
    const threads = new Map<string, Thread>();
    const backend: Executor = {
      check: async () => {},
      close: async () => {},
      find: async () => {
        return [];
      },
      send: async () => {
        throw new Error("No revisions expected");
      },
      link: async () => {
        links++;
      },
      read: async (h) => {
        return threads.get(h.threadId)!;
      },
      launch: async (input: Launch): Promise<Handle> => {
        const h = { threadId: `t${threads.size}`, runId: `r${threads.size}` };
        if (input.workspace.type === "worktree") {
          await git.cmd(
            root,
            "worktree",
            "add",
            "-b",
            input.workspace.branch,
            work,
            input.workspace.baseRef,
          );
          writeFileSync(join(work, "greeting.mjs"), 'console.log("hello");\n');
        } else {
          assert.equal(input.workspace.type, "existing_worktree");
          assert.equal((input.workspace as any).worktreePath, work);
        }
        const result =
          input.workspace.type === "worktree"
            ? JSON.stringify({
                summary: "Greeting implemented",
                acceptance: [
                  {
                    criterion: "The greeting command prints hello.",
                    evidence:
                      "greeting.mjs prints hello; required validation asserts it",
                  },
                ],
                validation: [],
                responses: [],
              })
            : JSON.stringify({
                verdict: "pass",
                findings: [],
                unmetAcceptanceCriteria: [],
                summary: "Greeting code reviewed",
              });
        threads.set(h.threadId, {
          handle: h,
          status: "completed",
          workspace: work,
          branch:
            input.workspace.type === "root" ? null : input.workspace.branch,
          pending: false,
          result,
        });
        return h;
      },
    };
    const cfg = {
      ...defaultConfig,
      validation: [
        {
          name: "greeting",
          argv: [
            process.execPath,
            "--input-type=module",
            "-e",
            'import {execFileSync} from "node:child_process"; import assert from "node:assert/strict"; assert.equal(execFileSync(process.execPath,["greeting.mjs"],{encoding:"utf8"}),"hello\\n");',
          ],
          timeoutMs: 10000,
        },
      ],
    };
    const j = await startJob(f, [f], cfg, store, git, root);
    const runner = new Runner(root, store, backend, git);
    await runner.advance(j);
    assert.equal(j.stage, "pr_open", j.error);
    assert.equal(j.validations[0].code, 0);
    assert.equal(creates, 1);
    assert.equal(links, 1);
    await runner.advance(j);
    assert.equal(creates, 1);
    assert.equal(await git.cmd(work, "rev-parse", "HEAD^{tree}"), j.candidate);
  } finally {
    store?.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
