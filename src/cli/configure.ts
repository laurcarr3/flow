import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, configSchema } from "../config.js";
import { choose, confirm } from "./prompts.js";
import { type Ask } from "./terminal.js";
export const configure = async (root: string, ask: Ask) => {
  const path = join(root, "flow.config.json");
  const before = readFileSync(path, "utf8");
  const cfg = config(root);
  const url = await ask(
    `T3 MCP URL (no tokens; Enter keeps ${cfg.t3.url ?? "environment setting / unset"}): `,
  );
  if (url) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error(
        "Use a T3 MCP URL without credentials, query parameters, or fragments.",
      );
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      )
    )
      throw new Error("Use HTTPS, except for a local loopback connection.");
    cfg.t3.url = url;
  }
  cfg.baseBranch =
    (await ask(`Base branch [${cfg.baseBranch}]: `)) || cfg.baseBranch;
  cfg.remote = (await ask(`Git remote [${cfg.remote}]: `)) || cfg.remote;
  const scriptsPath = join(root, "package.json");
  const scripts = existsSync(scriptsPath)
    ? Object.keys(JSON.parse(readFileSync(scriptsPath, "utf8")).scripts ?? {})
    : [];
  for (;;) {
    const action = await choose(
      ask,
      `Required validation: ${cfg.validation.map((v) => v.name).join(", ") || "none (execution will be blocked)"}`,
      [
        { value: "done", label: "Keep these commands and finish" },
        ...(scripts.length
          ? [
              {
                value: "script",
                label: "Add a package script (npm, pnpm, yarn, or bun)",
              },
            ]
          : []),
        { value: "custom", label: "Add a command by executable and arguments" },
        { value: "remove", label: "Remove a validation command" },
      ],
      "done",
    );
    if (!action) return false;
    if (action === "done") break;
    if (action === "remove") {
      const name = await choose(
        ask,
        "Remove which command?",
        cfg.validation.map((v) => ({ value: v.name, label: v.name })),
      );
      cfg.validation = cfg.validation.filter((v) => v.name !== name);
      continue;
    }
    let argv: string[];
    let name: string;
    if (action === "script") {
      const script = await choose(
        ask,
        "Select a script:",
        scripts.map((value) => ({ value, label: value })),
      );
      if (!script) continue;
      const manager = await choose(
        ask,
        "Select a package manager:",
        ["npm", "pnpm", "yarn", "bun"].map((value) => ({
          value,
          label: value,
        })),
        existsSync(join(root, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(root, "yarn.lock"))
            ? "yarn"
            : existsSync(join(root, "bun.lock"))
              ? "bun"
              : "npm",
      );
      if (!manager) continue;
      name = script;
      argv = [manager, "run", script];
    } else {
      name = await ask("Validation name: ");
      const executable = await ask(
        "Executable (for example, pytest; no shell syntax): ",
      );
      argv = [executable];
      for (;;) {
        const arg = await ask(
          "Next argument (Enter to finish; each answer is one literal argument): ",
        );
        if (!arg) break;
        argv.push(arg);
      }
    }
    if (!name.trim() || !argv[0].trim())
      throw new Error(
        "Validation name and executable are required. Configuration was not changed.",
      );
    if (
      cfg.validation.some((v) => v.name === name) &&
      !(await confirm(ask, `Replace validation ${name}?`))
    )
      continue;
    cfg.validation = cfg.validation.filter((v) => v.name !== name);
    cfg.validation.push({ name, argv, timeoutMs: 300000 });
  }
  const validated = configSchema.parse(cfg);
  if (
    !(await confirm(
      ask,
      `Save configuration?\n${JSON.stringify(validated, null, 2)}`,
    ))
  )
    return false;
  if (readFileSync(path, "utf8") !== before)
    throw new Error("Configuration changed during setup. Try again.");
  writeFileSync(path, JSON.stringify(validated, null, 2) + "\n");
  return true;
};
