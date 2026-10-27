import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { draft } from "../src/features/draft-feature.js";
import {
  DirectDrafter,
  draftCommand,
  parseDraftResult,
  type DraftProvider,
} from "../src/features/draft-provider.js";
import { Store } from "../src/state-store.js";
import { document } from "./fixtures.js";
const codexOutput = (markdown: string) =>
  [
    { type: "thread.started", thread_id: "codex-session" },
    { type: "item.completed", item: { type: "agent_message", text: markdown } },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "flow-draft-"));
  mkdirSync(join(root, "features"));
  const store = new Store(root);
  return {
    root,
    store,
    clean: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
};
for (const provider of ["codex", "claude"] as DraftProvider[]) {
  test(`${provider} drafting runs directly with stdin and saves only a draft`, async () => {
    const x = fixture();
    try {
      const input = 'Export "hello"; $(do-not-execute)';
      let calls = 0;
      const backend = new DirectDrafter(async (argv, cwd, prompt) => {
        calls++;
        assert.equal(argv[0], provider);
        assert.equal(cwd, x.root);
        assert.ok(prompt?.includes(input));
        assert.ok(!argv.includes(input));
        assert.equal(x.store.draft("hello").attempts[0].state, "running");
        return {
          code: 0,
          stderr: "",
          stdout:
            provider === "codex"
              ? codexOutput(
                  document().replace("status: draft", "status: ready"),
                )
              : JSON.stringify({
                  type: "result",
                  subtype: "success",
                  is_error: false,
                  result: document().replace("status: draft", "status: ready"),
                  session_id: "claude-session",
                }),
        };
      });
      await draft(x.root, x.store, backend, "hello", input, provider);
      assert.equal(calls, 1);
      assert.match(
        readFileSync(join(x.root, "features/hello.md"), "utf8"),
        /status: draft/,
      );
      assert.equal(x.store.draft("hello").provider, provider);
      assert.equal(
        x.store.draft("hello").attempts[0].sessionId,
        `${provider}-session`,
      );
      assert.equal(x.store.approval("hello"), undefined);
    } finally {
      x.clean();
    }
  });
}
test("missing provider preserves input and explains the selection", async () => {
  const x = fixture();
  try {
    await assert.rejects(
      draft(
        x.root,
        x.store,
        new DirectDrafter(async () => {
          throw Error("must not run");
        }),
        "hello",
        "my idea",
      ),
      /--provider/,
    );
    assert.equal(x.store.draft("hello").input, "my idea");
  } finally {
    x.clean();
  }
});
test("failed or interrupted draft never launches again without explicit retry", async () => {
  const x = fixture();
  try {
    let calls = 0;
    const backend = new DirectDrafter(async () => {
      calls++;
      throw Error("ENOENT: codex");
    });
    await assert.rejects(
      draft(x.root, x.store, backend, "hello", "my idea", "codex"),
      /codex login/,
    );
    await assert.rejects(
      draft(x.root, x.store, backend, "hello"),
      /--retry-draft/,
    );
    assert.equal(calls, 1);
    const d = x.store.draft("hello");
    d.attempts[0].state = "running";
    x.store.draft("hello", d);
    await assert.rejects(draft(x.root, x.store, backend, "hello"), /confirm/i);
    assert.equal(calls, 1);
    await assert.rejects(
      draft(x.root, x.store, backend, "hello", undefined, "codex", true),
    );
    assert.equal(calls, 2);
  } finally {
    x.clean();
  }
});
test("saved successful output is collected after interruption without another invocation", async () => {
  const x = fixture();
  try {
    x.store.draft("hello", {
      id: "hello",
      input: "my idea",
      provider: "codex",
      attempts: [
        {
          requestId: "id",
          provider: "codex",
          state: "completed",
          result: { code: 0, stderr: "", stdout: codexOutput(document()) },
        },
      ],
    });
    await draft(
      x.root,
      x.store,
      new DirectDrafter(async () => {
        throw Error("must not run");
      }),
      "hello",
    );
    assert.ok(existsSync(join(x.root, "features/hello.md")));
  } finally {
    x.clean();
  }
});
test("malformed results are retained, cannot save a feature, and can retry with another provider", async () => {
  const x = fixture();
  try {
    let calls = 0;
    const backend = new DirectDrafter(async () => {
      calls++;
      return { code: 0, stderr: "", stdout: codexOutput(document("wrong-id")) };
    });
    await assert.rejects(
      draft(x.root, x.store, backend, "hello", "idea", "codex"),
      /different feature ID/,
    );
    await assert.rejects(
      draft(x.root, x.store, backend, "hello"),
      /different feature ID/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      draft(x.root, x.store, backend, "hello", undefined, "claude"),
      /Changing/,
    );
    assert.ok(!existsSync(join(x.root, "features/hello.md")));
    const claude = new DirectDrafter(async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: document(),
      }),
    }));
    await draft(x.root, x.store, claude, "hello", undefined, "claude", true);
    assert.equal(x.store.draft("hello").attempts.length, 2);
  } finally {
    x.clean();
  }
});
test("legacy T3 input is preserved and requires explicit migration", async () => {
  const x = fixture();
  try {
    x.store.draft("hello", {
      id: "hello",
      input: "old request",
      attempted: true,
      handle: { threadId: "old-thread" },
    });
    const b = new DirectDrafter(async () => ({
      code: 0,
      stderr: "",
      stdout: codexOutput(document()),
    }));
    await assert.rejects(
      draft(x.root, x.store, b, "hello", undefined, "codex"),
      /old-thread/,
    );
    await draft(x.root, x.store, b, "hello", undefined, "codex", true);
    assert.equal(x.store.draft("hello").input, "old request");
  } finally {
    x.clean();
  }
});
test("provider commands and result parsers reject unsuccessful turns", () => {
  assert.ok(draftCommand("codex", "id").includes("read-only"));
  assert.ok(draftCommand("claude", "id").includes("Read,Glob,Grep"));
  assert.ok(draftCommand("claude", "id").includes("--strict-mcp-config"));
  assert.throws(
    () => parseDraftResult("codex", JSON.stringify({ type: "turn.failed" })),
    /successfully/,
  );
  assert.throws(() =>
    parseDraftResult(
      "claude",
      JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        result: "no auth",
      }),
    ),
  );
});
