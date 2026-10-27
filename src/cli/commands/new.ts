import { stdin } from "node:process";
import { idSchema } from "../../features/documents.js";
import { draft } from "../../features/draft-feature.js";
import {
  DirectDrafter,
  draftProviderSchema,
} from "../../features/draft-provider.js";
import { Store } from "../../state-store.js";
import { newFeatureWizard, nextFeatureId } from "../new-feature-wizard.js";
import { ask } from "../terminal.js";
export const newFeature = async (r: string, s: Store, opts: any) => {
  if (!Object.keys(opts).length) {
    if (!stdin.isTTY)
      throw new Error(
        "Run flow new in a terminal to choose a provider and enter your prompt. For scripts, supply --provider and --prompt or --stdin.",
      );
    console.log(await newFeatureWizard(r, s, ask));
    return;
  }
  if (opts.retryDraft && !opts.id)
    throw new Error(
      "Run flow new to select a saved request, or supply --id with --retry-draft.",
    );
  const id = idSchema.parse(opts.id ?? nextFeatureId(r, s));
  let input = opts.prompt;
  if (opts.stdin) {
    if (input) throw new Error("Choose --stdin or --prompt.");
    input = await new Promise<string>((resolve, reject) => {
      let s = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => (s += c));
      stdin.on("end", () => resolve(s));
      stdin.on("error", reject);
    });
  }
  if (!input && !s.draft(id))
    input = await ask("What do you want to implement? ");
  let provider = opts.provider ?? s.draft(id)?.provider;
  if (!provider && stdin.isTTY) {
    provider =
      (await ask("Drafting provider [codex/claude] (codex): ")) || "codex";
  }
  if (provider) draftProviderSchema.parse(provider);
  console.log(
    await draft(
      r,
      s,
      new DirectDrafter(),
      id,
      input,
      provider,
      opts.retryDraft,
    ),
  );
};
