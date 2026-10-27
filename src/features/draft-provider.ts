import { z } from "zod";
import { exec, type Exec } from "../process.js";

export const draftProviderSchema = z.enum(["codex", "claude"]);
export type DraftProvider = z.infer<typeof draftProviderSchema>;
export type DraftResult = { markdown: string; sessionId?: string };

export const draftCommand = (
  provider: DraftProvider,
  requestId: string,
): string[] => {
  if (provider === "codex") {
    return [
      "codex",
      "exec",
      "--sandbox",
      "read-only",
      "--json",
      "--color",
      "never",
      "-",
    ];
  }
  return [
    "claude",
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "json",
    "--permission-mode",
    "plan",
    "--tools",
    "Read,Glob,Grep",
    "--allowedTools",
    "Read,Glob,Grep",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--session-id",
    requestId,
  ];
};

export const parseDraftResult = (
  provider: DraftProvider,
  stdout: string,
): DraftResult => {
  if (provider === "claude") {
    const result = z
      .object({
        type: z.literal("result"),
        subtype: z.literal("success"),
        is_error: z.literal(false),
        result: z.string().min(1),
        session_id: z.string().optional(),
      })
      .parse(JSON.parse(stdout));
    return { markdown: result.result, sessionId: result.session_id };
  }
  const events = stdout
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) =>
      z.object({ type: z.string() }).passthrough().parse(JSON.parse(line)),
    );
  if (
    events.some((e) => ["error", "turn.failed"].includes(e.type)) ||
    !events.some((e) => e.type === "turn.completed")
  ) {
    throw new Error("Codex did not report a successfully completed turn.");
  }
  const messages = events
    .filter((e) => e.type === "item.completed")
    .map((e) => e.item as any)
    .filter((item) => item?.type === "agent_message");
  const markdown = z.string().min(1).parse(messages.at(-1)?.text);
  const started = events.find((e) => e.type === "thread.started");
  return {
    markdown,
    sessionId: z.string().optional().parse(started?.thread_id),
  };
};

export class DirectDrafter {
  constructor(private run: Exec = exec) {}
  generate = (
    provider: DraftProvider,
    requestId: string,
    root: string,
    prompt: string,
  ) => {
    // Prompts travel over stdin, never through shell interpolation or command arguments.
    return this.run(
      draftCommand(provider, requestId),
      root,
      prompt,
      15 * 60_000,
    );
  };
}
