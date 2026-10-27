import { spawn } from "node:child_process";
export type CommandResult = { code: number; stdout: string; stderr: string };
export type Exec = (
  argv: string[],
  cwd: string,
  input?: string,
  timeoutMs?: number,
) => Promise<CommandResult>;
export const exec: Exec = (argv, cwd, input, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      overflow = false,
      timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
      }
    };
    const stop = () => {
      terminate("SIGTERM");
      killTimer ??= setTimeout(() => terminate("SIGKILL"), 2000);
      killTimer.unref();
    };
    const collect = (s: string, chunk: string) => {
      if (s.length + chunk.length > 8_000_000) {
        overflow = true;
        stop();
        return s;
      }
      return s + chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (b) => {
      stdout = collect(stdout, b);
    });
    child.stderr.on("data", (b) => {
      stderr = collect(stderr, b);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code: timedOut ? 124 : overflow ? 125 : (code ?? 124),
        stdout,
        stderr: overflow ? "Output limit exceeded" : stderr,
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
export const checked = async (
  argv: string[],
  cwd: string,
  input?: string,
  run: Exec = exec,
): Promise<string> => {
  const r = await run(argv, cwd, input);
  if (r.code)
    throw new Error(
      `${argv[0]} ${argv[1] ?? ""} failed (${r.code}): ${r.stderr.slice(-2000)}`,
    );
  return r.stdout.trim();
};
