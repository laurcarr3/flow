import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  contentErrors,
  graphErrors,
  parseFeature,
  questions,
  withStatus,
} from "../src/features/documents.js";
import { Store } from "../src/state-store.js";
import { document } from "./fixtures.js";
test("strict frontmatter, meaningful content, and questions", () => {
  const f = parseFeature(document());
  assert.deepEqual(contentErrors(f), []);
  assert.equal(questions(f), null);
  assert.throws(() =>
    parseFeature(document().replace("status: draft", "status: implementing")),
  );
  assert.throws(() =>
    parseFeature(document().replace("id: hello", "id: ../escape")),
  );
  assert.throws(() =>
    parseFeature(
      document().replace("status: draft", "status: draft\nsecret: x"),
    ),
  );
  assert.equal(
    contentErrors(
      parseFeature(
        document().replace("Print hello to standard output.", "TODO"),
      ),
    ).length,
    1,
  );
  assert.equal(
    questions(parseFeature(document().replace("None.", "What language?"))),
    "What language?",
  );
});
test("missing dependencies and cycles; grouping is not an edge", () => {
  const a = parseFeature(document("a", "[b]")),
    b = parseFeature(document("b", "[a]"));
  assert.match(graphErrors([a])[0], /missing dependency/);
  assert.match(graphErrors([a, b])[0], /cycle/);
  assert.deepEqual(
    graphErrors([
      parseFeature(
        document("a").replace("status: draft", "status: draft\ngroup: common"),
      ),
      parseFeature(
        document("b").replace("status: draft", "status: draft\ngroup: common"),
      ),
    ]),
    [],
  );
});
test("approval binds exact ready document bytes and survives reopening", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-doc-"));
  let s = new Store(root);
  try {
    const ready = parseFeature(withStatus(parseFeature(document()), "ready"));
    s.approve(ready.id, ready.hash);
    s.close();
    s = new Store(root);
    assert.equal(s.approval("hello"), ready.hash);
    assert.notEqual(s.approval("hello"), parseFeature(ready.raw + "\n").hash);
  } finally {
    s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
