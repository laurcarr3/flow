import { realpathSync } from "node:fs";
import { z } from "zod";
import { checked, exec, type Exec } from "./process.js";
import { type Job } from "./workflow/job.js";
import { publish } from "./workflow/publication.js";

export const prSchema = z.object({
  url: z.url(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  headRefOid: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
});
export type PR = z.infer<typeof prSchema>;
export class Git {
  constructor(public run: Exec = exec) {}
  cmd = (cwd: string, ...args: string[]) => {
    return checked(["git", ...args], cwd, undefined, this.run);
  };
  binding = async (root: string, workspace: string, branch: string) => {
    const [a, b, actual] = await Promise.all([
      this.cmd(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      this.cmd(
        workspace,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ),
      this.cmd(workspace, "branch", "--show-current"),
    ]);
    if (
      realpathSync(a) !== realpathSync(b) ||
      actual !== branch ||
      realpathSync(root) === realpathSync(workspace)
    )
      throw new Error(
        "Workspace is not the dedicated feature branch in this repository.",
      );
  };
  candidate = async (workspace: string): Promise<string> => {
    const submodules = await this.cmd(workspace, "submodule", "status");
    if (submodules)
      throw new Error("Repositories with submodules are outside flow v0.");
    await this.cmd(workspace, "add", "--all");
    return this.cmd(workspace, "write-tree");
  };
  diff = (workspace: string, base: string) => {
    return this.cmd(workspace, "diff", "--cached", "--no-ext-diff", base, "--");
  };
  prs = async (j: Job): Promise<PR[]> => {
    const remote = await this.cmd(
      j.workspace!,
      "remote",
      "get-url",
      j.config.remote,
    );
    const result = await checked(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        remote,
        "--head",
        j.branch,
        "--state",
        "all",
        "--json",
        "url,state,isDraft,headRefOid,headRefName,baseRefName",
        "--limit",
        "100",
      ],
      j.workspace!,
      undefined,
      this.run,
    );
    return z.array(prSchema).parse(JSON.parse(result));
  };
  prState = async (
    url: string,
    root: string,
  ): Promise<"MERGED" | "OPEN" | "CLOSED"> => {
    const r = JSON.parse(
      await checked(
        ["gh", "pr", "view", url, "--json", "state"],
        root,
        undefined,
        this.run,
      ),
    );
    return z.enum(["MERGED", "OPEN", "CLOSED"]).parse(r.state);
  };
  publish = (j: Job, save: () => void, allowRetry = false): Promise<void> =>
    publish(this, j, save, allowRetry);
}

export const repoRoot = async (cwd = process.cwd()): Promise<string> => {
  return realpathSync(
    await checked(["git", "rev-parse", "--show-toplevel"], cwd),
  );
};
