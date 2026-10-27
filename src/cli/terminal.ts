import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
export const ask = async (prompt: string) => {
  if (!stdin.isTTY)
    throw new Error(
      "Interactive input requires a terminal; use explicit command flags.",
    );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
};

export type Ask = (message: string) => Promise<string>;
