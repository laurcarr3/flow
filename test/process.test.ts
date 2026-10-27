import assert from "node:assert/strict";
import { test } from "node:test";
import { exec } from "../src/process.js";
test("subprocess arguments remain literal, including shell syntax", async () => {
  const input = '$(touch unexpected); `echo nope` "quoted"';
  const r = await exec(
    [process.execPath, "-e", "process.stdout.write(process.argv[1])", input],
    process.cwd(),
  );
  assert.equal(r.code, 0);
  assert.equal(r.stdout, input);
});
test("timeout cannot pass even if process handles SIGTERM and exits successfully", async () => {
  const r = await exec(
    [
      process.execPath,
      "-e",
      'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)',
    ],
    process.cwd(),
    undefined,
    150,
  );
  assert.equal(r.code, 124);
});
