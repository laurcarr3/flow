import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  newFeatureWizard,
  nextFeatureId,
} from "../src/cli/new-feature-wizard.js";
import { type Ask } from "../src/cli/terminal.js";
import { DirectDrafter } from "../src/features/draft-provider.js";
import { Store } from "../src/state-store.js";
import { document } from "./fixtures.js";
const fixture = (name = "Chat App") => {
  const temp = mkdtempSync(join(tmpdir(), "flow-wizard-")),
    root = join(temp, name);
  mkdirSync(join(root, "features"), { recursive: true });
  const store = new Store(root);
  return {
    root,
    store,
    close: () => {
      store.close();
      rmSync(temp, { recursive: true, force: true });
    },
  };
};
const answers = (values: string[], prompts: string[] = []): Ask => {
  return async (message) => {
    prompts.push(message);
    assert.ok(values.length, `Unexpected prompt: ${message}`);
    return values.shift()!;
  };
};
const backend = (
  onCall: (provider: string, prompt: string) => void = () => {},
) => {
  return new DirectDrafter(async (argv, _cwd, prompt) => {
    onCall(argv[0], prompt!);
    const id = /frontmatter id: ([^,]+)/.exec(prompt!)![1];
    const markdown = document(id);
    return {
      code: 0,
      stderr: "",
      stdout:
        argv[0] === "claude"
          ? JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              result: markdown,
            })
          : [
              JSON.stringify({
                type: "item.completed",
                item: { type: "agent_message", text: markdown },
              }),
              JSON.stringify({ type: "turn.completed" }),
            ].join("\n"),
    };
  });
};
test("flow new asks provider then prompt and generates sequential repository IDs", async () => {
  const x = fixture();
  try {
    const prompts: string[] = [];
    const result = await newFeatureWizard(
      x.root,
      x.store,
      answers(["claude", "Add a greeting test"], prompts),
      backend((provider, prompt) => {
        assert.equal(provider, "claude");
        assert.match(prompt, /Add a greeting test/);
      }),
    );
    assert.match(prompts[0], /provider/);
    assert.match(prompts[1], /What do you want/);
    assert.match(result, /chat-app.md/);
    assert.match(
      readFileSync(join(x.root, "features/chat-app.md"), "utf8"),
      /status: draft/,
    );
    await newFeatureWizard(
      x.root,
      x.store,
      answers(["codex", "Add another feature"]),
      backend(),
    );
    assert.match(
      readFileSync(join(x.root, "features/chat-app-2.md"), "utf8"),
      /id: chat-app-2/,
    );
  } finally {
    x.close();
  }
});
test("IDs reserve pending requests and filenames; names normalize within schema bounds", () => {
  const x = fixture("Café ___ APP");
  try {
    assert.equal(nextFeatureId(x.root, x.store), "cafe-app");
    x.store.draft("cafe-app", { id: "cafe-app", input: "pending" });
    writeFileSync(
      join(x.root, "features/cafe-app-2.md"),
      document("unrelated-id"),
    );
    assert.equal(nextFeatureId(x.root, x.store), "cafe-app-3");
  } finally {
    x.close();
  }
  const y = fixture("😀");
  try {
    assert.equal(nextFeatureId(y.root, y.store), "feature");
  } finally {
    y.close();
  }
});
test("wizard requires confirmation before retry and reuses saved input", async () => {
  const x = fixture();
  try {
    x.store.draft("legacy-id", {
      id: "legacy-id",
      input: "Saved description",
      provider: "codex",
      attempts: [{ requestId: "old", provider: "codex", state: "running" }],
    });
    let calls = 0;
    const b = backend(() => {
      calls++;
    });
    const paused = await newFeatureWizard(
      x.root,
      x.store,
      answers(["1", "n"]),
      b,
    );
    assert.match(paused, /Kept/);
    assert.equal(calls, 0);
    await newFeatureWizard(
      x.root,
      x.store,
      answers(["1", "y", "claude"]),
      backend((provider, prompt) => {
        calls++;
        assert.equal(provider, "claude");
        assert.match(prompt, /Saved description/);
      }),
    );
    assert.equal(calls, 1);
    assert.equal(x.store.draft("legacy-id").attempts.length, 2);
  } finally {
    x.close();
  }
});
test("new request does not overwrite pending input; invalid provider and empty prompt are re-prompted", async () => {
  const x = fixture();
  try {
    x.store.draft("chat-app", {
      id: "chat-app",
      input: "Keep me",
      provider: "codex",
      attempts: [],
    });
    await newFeatureWizard(
      x.root,
      x.store,
      answers(["new", "bad-provider", "", "", "New description"]),
      backend(),
    );
    assert.equal(x.store.draft("chat-app").input, "Keep me");
    assert.equal(x.store.draft("chat-app-2").input, "New description");
  } finally {
    x.close();
  }
});
test("wizard collects completed output without launching or asking again", async () => {
  const x = fixture();
  try {
    x.store.draft("old", {
      id: "old",
      input: "Saved",
      provider: "claude",
      attempts: [
        {
          provider: "claude",
          requestId: "id",
          state: "completed",
          result: {
            code: 0,
            stderr: "",
            stdout: JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              result: document("old"),
            }),
          },
        },
      ],
    });
    await newFeatureWizard(
      x.root,
      x.store,
      answers(["1"]),
      new DirectDrafter(async () => {
        throw Error("must not run");
      }),
    );
    assert.match(
      readFileSync(join(x.root, "features/old.md"), "utf8"),
      /id: old/,
    );
  } finally {
    x.close();
  }
});
