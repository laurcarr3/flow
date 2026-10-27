import type { Git } from "../git.js";
import { checked } from "../process.js";
import type { Job } from "./job.js";
import { prBody } from "./pr-body.js";
import { hasPassingValidation } from "./validation.js";

export const publish = async (
  git: Git,
  j: Job,
  save: () => void,
  allowRetry = false,
): Promise<void> => {
  const cwd = j.workspace!;
  if (!j.candidate || (await git.candidate(cwd)) !== j.candidate)
    throw new Error(
      "Candidate changed before publication; fresh review and validation required.",
    );
  const last = j.reviews.at(-1);
  if (
    last?.candidate !== j.candidate ||
    last.result.verdict !== "pass" ||
    !j.config.validation.length ||
    j.config.validation.some((v) => !hasPassingValidation(j, v.name))
  )
    throw new Error("Publication gates are not satisfied.");
  if (!j.publication.commit) {
    const head = await git.cmd(cwd, "rev-parse", "HEAD");
    const tree = await git.cmd(cwd, "rev-parse", "HEAD^{tree}");
    if (tree !== j.candidate)
      await git.cmd(
        cwd,
        "commit",
        "-m",
        `feat: ${j.title}\n\nFlow-Job: ${j.id}`,
      );
    j.publication.commit = await git.cmd(cwd, "rev-parse", "HEAD");
    if ((await git.cmd(cwd, "rev-parse", "HEAD^{tree}")) !== j.candidate)
      throw new Error("Commit hook changed candidate; review required.");
    if (
      j.publication.commit === j.base ||
      (tree === j.candidate && head === j.base)
    )
      throw new Error("No implementation changes to publish.");
    save();
  }
  if (
    (await git.cmd(cwd, "rev-parse", "HEAD")) !== j.publication.commit ||
    (await git.candidate(cwd)) !== j.candidate
  )
    throw new Error("Published candidate changed locally.");
  const remoteHead = await git.cmd(
    cwd,
    "ls-remote",
    "--heads",
    j.config.remote,
    `refs/heads/${j.branch}`,
  );
  if (remoteHead && remoteHead.split(/\s/)[0] !== j.publication.commit)
    throw new Error(
      "Remote branch differs from candidate; refusing to overwrite it.",
    );
  if (!remoteHead)
    await git.cmd(
      cwd,
      "push",
      j.config.remote,
      `${j.publication.commit}:refs/heads/${j.branch}`,
    );
  j.publication.pushed = true;
  save();
  let prs = await git.prs(j);
  if (prs.length > 1)
    throw new Error(
      "Multiple PRs found for this branch; human reconciliation required.",
    );
  if (!prs.length) {
    if (j.publication.attempted && !allowRetry)
      throw new Error(
        "PR creation outcome is uncertain. No PR is visible yet. Inspect GitHub, then use resume --retry-publish only after confirming none exists.",
      );
    j.publication.attempted = true;
    save();
    const remote = await git.cmd(cwd, "remote", "get-url", j.config.remote);
    const body = prBody(j);
    await checked(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        remote,
        "--draft",
        "--base",
        j.config.baseBranch,
        "--head",
        j.branch,
        "--title",
        j.title,
        "--body-file",
        "-",
      ],
      cwd,
      body,
      git.run,
    );
    prs = await git.prs(j);
  }
  const pr = prs[0];
  if (
    !pr ||
    pr.headRefOid !== j.publication.commit ||
    pr.baseRefName !== j.config.baseBranch ||
    pr.headRefName !== j.branch ||
    (pr.state === "OPEN" && !pr.isDraft) ||
    pr.state === "CLOSED"
  )
    throw new Error(
      "Existing PR does not match the expected draft candidate; inspect it manually.",
    );
  j.publication.url = pr.url;
  save();
};
