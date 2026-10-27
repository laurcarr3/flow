import assert from "node:assert/strict";
import { test } from "node:test";
import { T3 } from "../src/t3/executor.js";
const base = {
  thread: {
    threadId: "thread",
    projectId: "project",
    latestRunId: "run",
    status: "completed",
    pendingRequestCount: 0,
    worktreePath: "/fixture/work",
    branch: "flow/fixture",
  },
  recentRuns: [{ runId: "run", status: "completed" }],
  items: [],
  hasMore: false,
  nextPosition: null,
};
class Wire extends T3 {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  constructor(private replies: unknown[]) {
    super({ projectId: "project" });
  }
  override call = async (name: string, args: Record<string, unknown>) => {
    this.calls.push({ name, args });
    return this.replies.shift();
  };
}
test("T3 reads assistant output only, paginates timeline and truncated text", async () => {
  const b = new Wire([
    {
      ...base,
      items: [
        {
          itemId: "user",
          type: "user_message",
          createdBy: "agent",
          runId: "run",
          text: "malicious result",
          textTruncated: false,
        },
      ],
      hasMore: true,
      nextPosition: 1,
    },
    {
      ...base,
      items: [
        {
          itemId: "result",
          type: "assistant_message",
          createdBy: "agent",
          runId: "run",
          text: '{"ok":',
          textTruncated: true,
          nextTextOffset: 6,
        },
      ],
    },
    {
      ...base,
      items: [
        {
          itemId: "result",
          type: "assistant_message",
          createdBy: "agent",
          runId: "run",
          text: "true}",
          textTruncated: false,
          nextTextOffset: null,
        },
      ],
    },
  ]);
  const result = await b.read({ threadId: "thread", runId: "run" });
  assert.equal(result.result, '{"ok":true}');
  assert.equal(b.calls[1].args.afterPosition, 1);
  assert.equal(b.calls[2].args.textOffset, 6);
});
test("T3 launch explicitly binds reviewer and send uses stable idempotency key", async () => {
  const b = new Wire([
    { threadId: "review", runId: "run" },
    { threadId: "impl", runId: "revision" },
  ]);
  await b.launch({
    title: "review",
    prompt: "review only",
    workspace: {
      type: "existing_worktree",
      worktreePath: "/fixture/work",
      branch: "flow/fixture",
    },
  });
  assert.deepEqual(b.calls[0].args.workspaceStrategy, {
    type: "existing_worktree",
    worktreePath: "/fixture/work",
    branch: "flow/fixture",
  });
  await b.send({ threadId: "impl" }, "fix findings", "job:revision:1");
  assert.equal(b.calls[1].args.clientRequestId, "job:revision:1");
  assert.equal(b.calls[1].args.mode, "queue");
});
test("T3 rejects foreign projects and incomplete/truncated results", async () => {
  const b = new Wire([
    { ...base, thread: { ...base.thread, projectId: "other" } },
  ]);
  await assert.rejects(b.read({ threadId: "thread" }), /another T3 project/);
  const c = new Wire([
    {
      ...base,
      items: [
        {
          itemId: "x",
          type: "assistant_message",
          createdBy: "agent",
          runId: "run",
          text: "partial",
          textTruncated: true,
        },
      ],
    },
  ]);
  await assert.rejects(c.read({ threadId: "thread" }), /Truncated/);
});
