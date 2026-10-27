import { stdin } from "node:process";
import { discover } from "../features/documents.js";
import { Git } from "../git.js";
import { roadmap } from "../roadmap.js";
import { cancelJob } from "./commands/cancel.js";
import { newFeature } from "./commands/new.js";
import { ready } from "./commands/ready.js";
import { runFeature } from "./commands/run.js";
import { status } from "./commands/status.js";
import { configure } from "./configure.js";
import { context } from "./context.js";
import { selectFeature } from "./select-feature.js";
import { ask } from "./terminal.js";
export const executeAction = async (
  action: string,
  id?: string,
  opts: any = {},
) => {
  return context(
    !["list", "status", "export"].includes(action),
    async (r, s) => {
      if (action === "init") {
        if (stdin.isTTY)
          console.log(
            (await configure(r, ask))
              ? "Configuration saved."
              : "Configuration unchanged.",
          );
        return;
      }
      if (action === "new") return newFeature(r, s, opts);
      if (action === "export") {
        console.log(
          JSON.stringify(await roadmap(discover(r), s, new Git(), r), null, 2),
        );
        return;
      }
      if (action === "list") {
        const fs = discover(r);
        if (!fs.length) console.log("No features. Run flow new.");
        for (const f of fs)
          console.log(
            `${f.id}\t${f.status}\t${s.approval(f.id) === f.hash ? "approved" : "unapproved"}\t${s.latest(f.id)?.stage ?? "-"}\t${f.title}`,
          );
        return;
      }
      if (action === "status") return status(r, s, id, opts.json);
      if (!id) {
        if (!stdin.isTTY)
          throw new Error(
            `Supply a feature ID for scripts: flow ${action} <feature>. Run flow ${action} in a terminal to select one.`,
          );
        id = await selectFeature(ask, action, discover(r), s);
        if (!id) return;
      }
      if (action === "ready") await ready(r, s, id, opts);
      else if (action === "cancel") await cancelJob(r, s, id);
      else await runFeature(r, s, id, action === "resume", opts);
    },
  );
};
