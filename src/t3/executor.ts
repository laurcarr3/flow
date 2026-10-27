import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { type Config } from "../config.js";
import {
  type Executor,
  type Handle,
  type Launch,
  type Thread,
} from "../executor.js";
import { handleSchema, readSchema } from "./schemas.js";
export class T3 implements Executor {
  private client?: Client;
  private projectId?: string;
  private names = new Set<string>();
  constructor(private settings: Config["t3"]) {
    this.projectId = settings.projectId;
  }
  connect = async () => {
    if (this.client) return;
    const url = this.settings.url ?? process.env.FLOW_T3_URL;
    if (!url)
      throw new Error(
        "T3 access is not configured. Copy MCP URL from T3 Settings → Connections and set t3.url in flow.config.json or FLOW_T3_URL. OAuth will ask for authorization in your browser.",
      );
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error(
        "T3 URL must not contain credentials, query parameters or fragments.",
      );
    const require = createRequire(import.meta.url);
    const proxy = require.resolve("mcp-remote/dist/proxy.js");
    const client = new Client({ name: "flow", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        proxy,
        url,
        ...(parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
          ? ["--allow-http"]
          : []),
      ],
      stderr: "inherit",
      ...(process.env.MCP_REMOTE_CONFIG_DIR
        ? {
            env: {
              ...process.env,
              MCP_REMOTE_CONFIG_DIR: process.env.MCP_REMOTE_CONFIG_DIR,
            } as Record<string, string>,
          }
        : {}),
    });
    try {
      await client.connect(transport);
      let cursor: string | undefined;
      do {
        const r = await client.listTools({ cursor });
        r.tools.forEach((t) => this.names.add(t.name));
        cursor = r.nextCursor;
      } while (cursor);
      for (const n of [
        "t3_thread_launch",
        "t3_thread_list",
        "t3_thread_read",
        "t3_thread_send",
        "t3_project_list",
        "t3_project_read",
      ])
        if (!this.names.has(n))
          throw new Error(`T3 lacks required tool ${n}; update T3.`);
      this.client = client;
    } catch (e) {
      await transport.close();
      throw e;
    }
  };
  call = async (name: string, args: Record<string, unknown>): Promise<any> => {
    await this.connect();
    const result = await this.client!.callTool({ name, arguments: args });
    if (result.isError)
      throw new Error(`T3 ${name}: ${JSON.stringify(result.content)}`);
    if (result.structuredContent) return result.structuredContent;
    const blocks = result.content as { type: string; text?: string }[];
    return JSON.parse(
      blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(""),
    );
  };
  check = async (root: string) => {
    await this.connect();
    if (!this.projectId) {
      let cursor: number | null = null;
      const matches: string[] = [];
      do {
        const page = await this.call("t3_project_list", { cursor, limit: 100 });
        for (const p of page.projects) {
          try {
            if (
              p.workspaceRoot &&
              realpathSync(p.workspaceRoot) === realpathSync(root)
            )
              matches.push(p.id);
          } catch {
            /* Unrelated project may no longer exist on this machine. */
          }
        }
        cursor = page.nextCursor;
      } while (cursor !== null && cursor !== undefined);
      if (matches.length !== 1)
        throw new Error(
          "Open this repository as a T3 project, then set t3.projectId if automatic discovery is ambiguous.",
        );
      this.projectId = matches[0];
    }
    const r = await this.call("t3_project_read", { projectId: this.projectId });
    const p = r.project ?? r;
    if (realpathSync(p.workspaceRoot) !== realpathSync(root))
      throw new Error(
        "T3 project workspace does not match repository. Remote filesystem execution is outside v0.",
      );
    return { projectId: this.projectId! };
  };
  find = async (title: string): Promise<Handle[]> => {
    const found: Handle[] = [];
    let cursor: number | null = null;
    do {
      const r = await this.call("t3_thread_list", {
        projectId: this.projectId,
        titleContains: title,
        limit: 100,
        cursor,
      });
      for (const t of r.threads)
        if (t.title === title)
          found.push({ threadId: t.threadId, runId: t.latestRunId });
      cursor = r.nextCursor;
    } while (cursor !== null && cursor !== undefined);
    return found;
  };
  launch = async (input: Launch): Promise<Handle> => {
    return handleSchema.parse(
      await this.call("t3_thread_launch", {
        projectId: this.projectId,
        title: input.title,
        message: input.prompt,
        workspaceStrategy: input.workspace,
        ...(this.settings.modelSelection
          ? { modelSelection: this.settings.modelSelection }
          : {}),
        interactionMode: "default",
      }),
    );
  };
  send = async (
    handle: Handle,
    prompt: string,
    key: string,
  ): Promise<Handle> => {
    return handleSchema.parse(
      await this.call("t3_thread_send", {
        threadId: handle.threadId,
        message: prompt,
        mode: "queue",
        clientRequestId: key,
      }),
    );
  };
  read = async (handle: Handle): Promise<Thread> => {
    let page = readSchema.parse(
      await this.call("t3_thread_read", {
        threadId: handle.threadId,
        limit: 100,
        maxCharsPerItem: 16000,
      }),
    );
    if (page.thread.projectId !== this.projectId)
      throw new Error("Thread belongs to another T3 project.");
    const thread = page.thread;
    const expected = page.recentRuns.find((r) => r.runId === handle.runId);
    const runId =
      expected &&
      ["preparing", "queued", "starting", "running", "waiting"].includes(
        expected.status,
      )
        ? expected.runId
        : (thread.latestRunId ?? handle.runId);
    const status = [
      "preparing",
      "queued",
      "starting",
      "running",
      "waiting",
    ].includes(thread.status)
      ? thread.status
      : (page.recentRuns.find((r) => r.runId === runId)?.status ??
        thread.status);
    const items = [...page.items];
    while (page.hasMore) {
      if (page.nextPosition === null)
        throw new Error("Invalid T3 timeline pagination");
      page = readSchema.parse(
        await this.call("t3_thread_read", {
          threadId: handle.threadId,
          afterPosition: page.nextPosition,
          limit: 100,
          maxCharsPerItem: 16000,
        }),
      );
      items.push(...page.items);
    }
    const last = items
      .filter(
        (i) =>
          i.createdBy === "agent" &&
          i.runId === runId &&
          i.text &&
          i.type === "assistant_message",
      )
      .at(-1);
    let result = last?.text ?? undefined;
    if (last?.textTruncated) {
      let offset = last.nextTextOffset;
      if (offset == null)
        throw new Error("Truncated T3 result without continuation");
      while (offset != null) {
        const more = readSchema.parse(
          await this.call("t3_thread_read", {
            threadId: handle.threadId,
            itemId: last.itemId,
            textOffset: offset,
            maxCharsPerItem: 16000,
          }),
        );
        const part = more.items.find((i) => i.itemId === last.itemId);
        if (!part || part.nextTextOffset === offset)
          throw new Error("Invalid T3 text pagination");
        result += part.text ?? "";
        offset = part.nextTextOffset;
      }
    }
    return {
      handle: { threadId: handle.threadId, runId },
      status,
      workspace: thread.worktreePath,
      branch: thread.branch,
      pending: thread.pendingRequestCount > 0 || status === "waiting",
      result,
    };
  };
  link = async (handle: Handle, url: string) => {
    if (this.names.has("link_pull_request"))
      await this.call("link_pull_request", { threadId: handle.threadId, url });
    else if (this.names.has("t3_thread_update")) {
      const m = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)$/.exec(url);
      if (!m) throw new Error("Cannot parse PR URL for T3 linking");
      await this.call("t3_thread_update", {
        threadId: handle.threadId,
        action: "link_pull_request",
        pullRequest: { url, repository: m[1], number: Number(m[2]) },
        clientRequestId: `flow-link-${handle.threadId}-${m[2]}`,
      });
    } else
      throw new Error("T3 does not expose PR linking; PR is saved locally.");
  };
  close = async () => {
    await this.client?.close();
  };
}
