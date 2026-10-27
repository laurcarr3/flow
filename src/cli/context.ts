import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin } from "node:process";
import { config } from "../config.js";
import { repoRoot } from "../git.js";
import { initialize } from "../init.js";
import { checked } from "../process.js";
import { Store } from "../state-store.js";
import { confirm } from "./prompts.js";
import { ask } from "./terminal.js";
export const root = async () => {
  const cwd = await repoRoot();
  const common = await checked(
    ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd,
  );
  // All worktrees share the primary checkout's state/claim.
  if (common.endsWith("/.git")) return realpathSync(dirname(common));
  throw new Error("flow v0 requires a normal non-bare Git repository.");
};
export const context = async <T>(
  mutating: boolean,
  fn: (r: string, s: Store) => Promise<T>,
) => {
  const r = await root();
  if (
    stdin.isTTY &&
    (!existsSync(join(r, "features")) ||
      !existsSync(join(r, "flow.config.json")))
  ) {
    if (!(await confirm(ask, "Initialize flow here?"))) return;
    initialize(r);
  }
  config(r);
  const store = new Store(r);
  let unlock: (() => void) | undefined;
  try {
    if (mutating) unlock = store.lock();
    return await fn(r, store);
  } finally {
    unlock?.();
    store.close();
  }
};
