import { stdin } from "node:process";
import { config } from "../../config.js";
import { discover, feature } from "../../features/documents.js";
import { Git } from "../../git.js";
import { Store } from "../../state-store.js";
import { T3 } from "../../t3/executor.js";
import { Runner } from "../../workflow/runner.js";
import { startJob } from "../../workflow/start-job.js";
import { choose } from "../prompts.js";
import { recoveryOptions } from "../recovery.js";
import { report } from "../report.js";
import { ask } from "../terminal.js";
export const runFeature = async (
  r: string,
  s: Store,
  id: string,
  resume: boolean,
  opts: any,
) => {
  const cfg = config(r),
    git = new Git();
  let j = resume ? s.latest(id) : undefined;
  if (resume && !j) throw new Error("No existing job; use flow run.");
  if (stdin.isTTY) {
    if (
      j &&
      resume &&
      !["retryLaunch", "retryPublish", "retryValidation", "recheck"].some(
        (key) => opts[key],
      )
    ) {
      const recovery = await recoveryOptions(ask, j);
      if (!recovery) return;
      opts = { ...opts, ...recovery };
    }
    if (opts.wait === undefined) {
      const mode = await choose(
        ask,
        "Progress:",
        [
          {
            value: "wait",
            label: "Follow progress for up to 15 minutes (Ctrl-C is safe)",
          },
          { value: "return", label: "Advance once and return to the menu" },
        ],
        "wait",
      );
      if (!mode) return;
      opts.wait = mode === "wait";
    }
  }
  j ??= await startJob(feature(r, id), discover(r), cfg, s, git, r);
  const backend = new T3({
    ...j.config.t3,
    url: cfg.t3.url ?? j.config.t3.url,
    projectId: j.config.t3.projectId ?? cfg.t3.projectId,
  });
  try {
    const runner = new Runner(r, s, backend, git);
    const deadline = Date.now() + (opts.wait ? 15 * 60_000 : 0);
    do {
      j = await runner.advance(j, opts);
      opts = { wait: opts.wait };
      if (
        j.outcome !== "active" ||
        j.stage === "pr_open" ||
        Date.now() >= deadline
      )
        break;
      console.error(`${j.stage}: waiting for T3; Ctrl-C is safe.`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } while (true);
    report(j);
  } finally {
    await backend.close();
  }
};
