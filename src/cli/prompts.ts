import { type Ask } from "./terminal.js";
export const choose = async <T extends string>(
  ask: Ask,
  title: string,
  choices: { value: T; label: string }[],
  fallback?: T,
): Promise<T | undefined> => {
  for (;;) {
    const answer = (
      await ask(
        `${title}\n${choices.map((c, i) => `${i + 1}. ${c.label}`).join("\n")}\nChoose a number${fallback ? ` [${choices.findIndex((c) => c.value === fallback) + 1}]` : ""}, or q to go back: `,
      )
    ).trim();
    if (answer.toLowerCase() === "q") return;
    if (!answer && fallback) return fallback;
    const exact = choices.find((c) => c.value === answer);
    if (exact) return exact.value;
    if (/^\d+$/.test(answer)) {
      const choice = choices[Number(answer) - 1];
      if (choice) return choice.value;
    }
  }
};
export const confirm = async (ask: Ask, message: string): Promise<boolean> => {
  for (;;) {
    const answer = (await ask(`${message} [y/N] `)).trim().toLowerCase();
    if (["y", "yes"].includes(answer)) return true;
    if (["", "n", "no", "q"].includes(answer)) return false;
  }
};
