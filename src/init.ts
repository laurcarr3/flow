import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { defaultConfig } from "./config.js";
export const initialize = (root: string) => {
  mkdirSync(join(root, "features"), { recursive: true });
  if (!existsSync(join(root, "flow.config.json")))
    writeFileSync(
      join(root, "flow.config.json"),
      JSON.stringify(defaultConfig, null, 2) + "\n",
    );
  const ignore = join(root, ".gitignore");
  if (
    !existsSync(ignore) ||
    !readFileSync(ignore, "utf8").split("\n").includes("/.flow/")
  )
    appendFileSync(ignore, "\n/.flow/\n");
};
