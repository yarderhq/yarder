import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const wrapper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/run-service.js");

describe("run-service wrapper", () => {
  it("writes crashing command stderr to the log file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yarder-run-service-"));
    const outFile = path.join(dir, "out.log");
    const errFile = path.join(dir, "err.log");
    const command = `node -e "console.error('missing-storage-env'); process.exit(1)"`;

    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [wrapper], {
        env: {
          ...process.env,
          YARDER_RUN_COMMAND: command,
          YARDER_RUN_CWD: dir,
          YARDER_LOG_OUT: outFile,
          YARDER_LOG_ERR: errFile,
        },
        stdio: "ignore",
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });

    assert.equal(exitCode, 1);
    assert.match(fs.readFileSync(errFile, "utf8"), /missing-storage-env/);
  });
});
