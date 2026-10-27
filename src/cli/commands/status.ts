import { stdin } from "node:process";
import { discover } from "../../features/documents.js";
import { Git } from "../../git.js";
import { roadmap } from "../../roadmap.js";
import { Store } from "../../state-store.js";
import { formatFeatureStatus } from "../output.js";
import { report } from "../report.js";
export const status = async (
  r: string,
  s: Store,
  id?: string,
  json = false,
) => {
  const data = await roadmap(discover(r), s, new Git(), r);
  if (id && !data.features.some((f) => f.id === id) && !s.latest(id))
    throw new Error(`Unknown feature: ${id}`);
  if (json || !stdin.isTTY) {
    console.log(
      JSON.stringify(
        id
          ? (data.features.find((f) => f.id === id) ?? {
              id,
              execution: s.latest(id)?.stage,
            })
          : data,
        null,
        2,
      ),
    );
    return;
  }
  if (data.graphErrors.length)
    console.log(`Document errors:\n${data.graphErrors.join("\n")}`);
  const items = id ? data.features.filter((f) => f.id === id) : data.features;
  if (!items.length && !id)
    console.log("No features. Select New to create a draft.");
  for (const f of items)
    console.log(formatFeatureStatus(f, s.latest(f.id)?.error));
  if (id && !items.length) {
    const j = s.latest(id);
    if (j) report(j);
  }
};
