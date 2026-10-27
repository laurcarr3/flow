import { readFileSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import {
  contentErrors,
  discover,
  feature,
  graphErrors,
  parseFeature,
  questions,
  withStatus,
} from "../../features/documents.js";
import { Store } from "../../state-store.js";
import { confirm } from "../prompts.js";
import { ask } from "../terminal.js";
export const ready = async (
  r: string,
  s: Store,
  id: string,
  opts: { yes?: boolean; acceptQuestions?: boolean },
) => {
  const f = feature(r, id),
    errors = [...contentErrors(f), ...graphErrors(discover(r))];
  if (f.status === "cancelled")
    throw new Error(
      "Edit status to draft before approving a cancelled feature.",
    );
  if (errors.length) throw new Error(errors.join("\n"));
  if (stdin.isTTY) console.log(`Document: ${f.path}\n\n${f.raw}`);
  const q = questions(f);
  if (q) {
    console.error(`Unresolved questions:\n${q}`);
    if (
      !opts.acceptQuestions &&
      (!stdin.isTTY ||
        !(await confirm(
          ask,
          "Approve this scope with these unresolved questions?",
        )))
    )
      throw new Error(
        "Resolve questions or explicitly acknowledge them with --accept-questions.",
      );
  }
  if (
    !opts.yes &&
    (!stdin.isTTY || !(await confirm(ask, `Approve current content of ${id}?`)))
  )
    throw new Error(
      "Explicit approval required. Use --yes for noninteractive approval.",
    );
  const raw = withStatus(f, "ready");
  // Check for concurrent editor changes before replacing the file.
  if (readFileSync(f.path, "utf8") !== f.raw)
    throw new Error("Document changed during approval; try again.");
  writeFileSync(f.path, raw);
  s.approve(id, parseFeature(raw).hash);
  console.log(`Approved ${id}.`);
};
