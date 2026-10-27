import { randomUUID } from "node:crypto";
import { type Config } from "../config.js";
import {
  contentErrors,
  graphErrors,
  type Feature,
} from "../features/documents.js";
import { Git } from "../git.js";
import { Store } from "../state-store.js";
import { dependencyBlockers } from "./dependencies.js";
import { type Job } from "./job.js";
export const startJob = async (
  f: Feature,
  features: Feature[],
  cfg: Config,
  store: Store,
  git: Git,
  root: string,
): Promise<Job> => {
  const errors = [...contentErrors(f), ...graphErrors(features)];
  if (errors.length) throw new Error(errors.join("\n"));
  if (f.status !== "ready" || store.approval(f.id) !== f.hash)
    throw new Error(
      "Feature needs explicit approval of its current content: flow ready " +
        f.id,
    );
  if (store.active())
    throw new Error(
      "A feature is already executing; use flow resume or flow cancel.",
    );
  if (store.latest(f.id)?.publication.url)
    throw new Error(
      "This feature already has an implementation PR. Use a new feature ID for further scope.",
    );
  const blockers = await dependencyBlockers(f, store, git, root);
  if (blockers.length) throw new Error(blockers.join("\n"));
  if (!cfg.validation.length)
    throw new Error(
      "Configure at least one required validation command in flow.config.json before running.",
    );
  if (new Set(cfg.validation.map((v) => v.name)).size !== cfg.validation.length)
    throw new Error("Validation command names must be unique.");
  // Fetch the publication base so merged prerequisites are present in the checkout.
  await git.cmd(root, "fetch", cfg.remote, cfg.baseBranch);
  const base = await git.cmd(
    root,
    "rev-parse",
    "--verify",
    "FETCH_HEAD^{commit}",
  );
  const id = randomUUID();
  const j: Job = {
    id,
    featureId: f.id,
    title: f.title,
    approvedHash: f.hash,
    snapshot: f.raw,
    stage: "preparing",
    outcome: "active",
    config: cfg,
    base,
    branch: `flow/${f.id}-${id.slice(0, 8)}`,
    operations: [],
    revision: 0,
    reviews: [],
    validations: [],
    publication: {},
  };
  store.save(j);
  return j;
};
