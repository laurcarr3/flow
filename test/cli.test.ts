import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { exec } from "../src/process.js";
import { document } from "./fixtures.js";
const entry = resolve("src/main.ts"),
  tsx = resolve("node_modules/tsx/dist/loader.mjs");
test("CLI init, empty status, explicit approval, export, invalidation, preserved draft input", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-cli-"));
  const cli = (...args: string[]) =>
    exec([process.execPath, "--import", tsx, entry, ...args], root);
  try {
    await exec(["git", "init", "-b", "main"], root);
    assert.equal((await cli("init")).code, 0);
    const empty = await cli("export", "--json");
    assert.equal(empty.code, 0);
    assert.equal((await cli("export")).stdout, empty.stdout);
    for (const command of ["ready", "run", "resume", "cancel"]) {
      const missing = await cli(command);
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /Supply a feature ID/);
    }
    assert.deepEqual(JSON.parse(empty.stdout).features, []);
    writeFileSync(join(root, "features", "hello.md"), document());
    assert.notEqual((await cli("ready", "hello")).code, 0);
    assert.equal((await cli("ready", "hello", "--yes")).code, 0);
    let out = JSON.parse((await cli("export", "--json")).stdout);
    assert.equal(out.features[0].document.approvalMatches, true);
    writeFileSync(
      join(root, "features", "hello.md"),
      readFileSync(join(root, "features", "hello.md"), "utf8") + "\n",
    );
    out = JSON.parse((await cli("export", "--json")).stdout);
    assert.equal(out.features[0].document.approvalMatches, false);
    const draft = await cli(
      "new",
      "--id",
      "idea",
      "--prompt",
      "Preserve my exact idea",
    );
    assert.notEqual(draft.code, 0);
    assert.match(draft.stderr, /input is preserved/);
    assert.match(
      (await cli("new", "--id", "idea")).stderr,
      /input is preserved/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI selects direct drafting providers without any T3 configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-cli-providers-"));
  try {
    await exec(["git", "init", "-b", "main"], root);
    await exec([process.execPath, "--import", tsx, entry, "init"], root);
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const provider of ["codex", "claude"]) {
      const markdown = document(provider);
      const output =
        provider === "codex"
          ? [
              { type: "thread.started", thread_id: "fixture-session" },
              {
                type: "item.completed",
                item: { type: "agent_message", text: markdown },
              },
              { type: "turn.completed" },
            ]
              .map((e) => JSON.stringify(e))
              .join("\n")
          : JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              result: markdown,
            });
      writeFileSync(
        join(bin, provider),
        `#!${process.execPath}\nlet input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{if(!input.includes('Draft a minimal feature PRD'))process.exit(2);process.stdout.write(${JSON.stringify(output)});});\n`,
        { mode: 0o755 },
      );
      const r = await exec(
        [
          "env",
          `PATH=${bin}:${process.env.PATH}`,
          process.execPath,
          "--import",
          tsx,
          entry,
          "new",
          "--id",
          provider,
          "--provider",
          provider,
          "--prompt",
          "Add a greeting test",
        ],
        root,
      );
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`using ${provider}`));
      assert.match(
        readFileSync(join(root, "features", `${provider}.md`), "utf8"),
        /status: draft/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
