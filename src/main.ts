#!/usr/bin/env node
import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stdin } from "node:process";
import { executeAction } from "./cli/actions.js";
import { root } from "./cli/context.js";
import { choose, confirm } from "./cli/prompts.js";
import { ask } from "./cli/terminal.js";
import { discover } from "./features/documents.js";
import { initialize } from "./init.js";
const cli = new Command()
  .name("flow")
  .description(
    "Approved Markdown features to reviewed draft PRs; run without arguments for the menu",
  )
  .version("0.1.0");
cli
  .command("init")
  .description("Initialize flow and configure the repository interactively")
  .option("--defaults", "create default configuration without questions")
  .action(async (opts) => {
    const r = await root();
    initialize(r);
    if (stdin.isTTY && !opts.defaults) await executeAction("init");
    else
      console.log(
        "Initialized flow. Configure T3 and required validation in flow.config.json, or run flow init in a terminal.",
      );
  });
cli
  .command("new")
  .description("Choose a drafting provider and describe a feature")
  .option("--id <id>")
  .option("--prompt <description>")
  .option("--stdin")
  .option("--provider <provider>", "draft directly with codex or claude")
  .option(
    "--retry-draft",
    "confirm the prior agent process has stopped and request new output",
  )
  .action((opts) => executeAction("new", undefined, opts));
cli
  .command("ready [feature]")
  .description("Select a document and explicitly approve its current content")
  .option("-y, --yes", "explicitly approve current content")
  .option("--accept-questions", "acknowledge unresolved questions")
  .action((id, opts) => executeAction("ready", id, opts));
cli
  .command("run [feature]")
  .description("Select an approved feature and start implementation")
  .option("--wait", "follow progress for up to 15 minutes")
  .option("--no-wait", "advance once and return")
  .action((id, opts) => executeAction("run", id, opts));
cli
  .command("resume [feature]")
  .description("Select a job and choose how to continue or recover it")
  .option("--wait")
  .option("--no-wait")
  .option(
    "--retry-launch",
    "confirm no thread exists after an uncertain launch",
  )
  .option("--retry-publish", "confirm no PR exists after uncertain creation")
  .option(
    "--retry-validation",
    "confirm interrupted validation processes have stopped",
  )
  .option("--recheck", "review current candidate afresh after human fixes")
  .action((id, opts) => executeAction("resume", id, opts));
cli
  .command("list")
  .description("List feature documents and execution stages")
  .action(() => executeAction("list"));
cli
  .command("status [feature]")
  .description("Show readable progress in a terminal, or JSON in scripts")
  .option("--json", "print JSON even in a terminal")
  .action((id, opts) => executeAction("status", id, opts));
cli
  .command("export")
  .description("Export versioned roadmap JSON (no flags required)")
  .option("--json", "export JSON (the default)")
  .action(() => executeAction("export"));
cli
  .command("cancel [feature]")
  .description(
    "Select a stopped job and release its local claim; preserve all work",
  )
  .action((id) => executeAction("cancel", id));
cli.action(async () => {
  if (!stdin.isTTY) {
    cli.outputHelp();
    return;
  }
  const r = await root();
  if (
    !existsSync(join(r, "features")) ||
    !existsSync(join(r, "flow.config.json"))
  ) {
    if (!(await confirm(ask, "Initialize flow here?"))) return;
    initialize(r);
    await executeAction("init");
  }
  if (!discover(r).length && (await confirm(ask, "No features. Create one?"))) {
    try {
      await executeAction("new");
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
  }
  for (;;) {
    const action = await choose(ask, "flow — What do you want to do?", [
      { value: "new", label: "New — draft a feature with Codex or Claude" },
      { value: "ready", label: "Ready — approve a feature document" },
      { value: "run", label: "Run — implement an approved feature" },
      { value: "resume", label: "Resume — continue or recover a job" },
      { value: "status", label: "Status — view progress and blockers" },
      { value: "list", label: "List — show all features" },
      { value: "cancel", label: "Cancel — release a stopped job" },
      { value: "export", label: "Export — print roadmap JSON" },
      {
        value: "init",
        label: "Setup — edit connection and validation commands",
      },
    ]);
    if (!action) return;
    try {
      process.exitCode = 0;
      await executeAction(action);
    } catch (e) {
      console.error(`flow: ${e instanceof Error ? e.message : e}`);
    }
  }
});
cli.parseAsync().catch((e) => {
  console.error(`flow: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
