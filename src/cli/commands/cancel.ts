import { stdin } from "node:process";
import { config } from "../../config.js";
import { threadLink } from "../../executor.js";
import { Store } from "../../state-store.js";
import { T3 } from "../../t3/executor.js";
import { confirm } from "../prompts.js";
import { ask } from "../terminal.js";
export const cancelJob = async (r: string, s: Store, id: string) => {
  if (
    stdin.isTTY &&
    !(await confirm(
      ask,
      `Cancel the local job for ${id}? Stop its threads in T3 first. All files and worktrees will be kept.`,
    ))
  )
    return;

  const j = s.latest(id);
  if (!j || j.stage === "pr_open") throw new Error("No cancellable job.");
  if (j.validationInFlight)
    throw new Error("Reconcile interrupted validation before cancellation.");
  if (j.operations.some((o) => o.attempted && !o.handle))
    throw new Error(
      "Reconcile uncertain backend operations before cancellation.",
    );
  const b = new T3({
    ...j.config.t3,
    url: config(r).t3.url ?? j.config.t3.url,
  });
  try {
    if (j.operations.some((o) => o.handle)) await b.check(r);
    for (const op of j.operations)
      if (op.handle) {
        const t = await b.read(op.handle);
        if (
          ![
            "completed",
            "cancelled",
            "failed",
            "interrupted",
            "rolled_back",
          ].includes(t.status)
        )
          throw new Error(
            `Stop the thread in T3 first: ${threadLink(op.handle)}`,
          );
      }
    j.outcome = "cancelled";
    s.save(j);
    console.log("Cancelled local job; all work is preserved.");
  } finally {
    await b.close();
  }
};
