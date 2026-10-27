import { type Feature } from "../features/documents.js";
import { Git } from "../git.js";
import { Store } from "../state-store.js";
export const dependencyBlockers = async (
  f: Feature,
  store: Store,
  git: Git,
  root: string,
): Promise<string[]> => {
  const blockers: string[] = [];
  for (const id of [...f.depends_on].sort()) {
    const url = store.latest(id)?.publication.url;
    if (!url) {
      blockers.push(`${id}: no implementation PR`);
      continue;
    }
    try {
      const state = await git.prState(url, root);
      if (state !== "MERGED")
        blockers.push(`${id}: PR is ${state.toLowerCase()}`);
    } catch {
      blockers.push(`${id}: could not confirm PR merge status`);
    }
  }
  return blockers;
};
