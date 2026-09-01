#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const command = process.env.YARDER_RUN_COMMAND;
const cwd = process.env.YARDER_RUN_CWD || process.cwd();
const outFile = process.env.YARDER_LOG_OUT;
const errFile = process.env.YARDER_LOG_ERR;

if (!command) {
  process.stderr.write("YARDER_RUN_COMMAND is not set\n");
  process.exit(1);
}

if (outFile) fs.mkdirSync(path.dirname(outFile), { recursive: true });
if (errFile) fs.mkdirSync(path.dirname(errFile), { recursive: true });
if (outFile) fs.writeFileSync(outFile, "");
if (errFile) fs.writeFileSync(errFile, "");

const childEnv = { ...process.env };
delete childEnv.YARDER_RUN_COMMAND;
delete childEnv.YARDER_RUN_CWD;
delete childEnv.YARDER_LOG_OUT;
delete childEnv.YARDER_LOG_ERR;

const child =
  process.platform === "win32"
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
        cwd,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
    : spawn("/bin/sh", ["-c", command], {
        cwd,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

function append(file, chunk) {
  if (!file) return;
  fs.appendFileSync(file, chunk);
}

child.stdout?.on("data", (chunk) => {
  append(outFile, chunk);
  process.stdout.write(chunk);
});

child.stderr?.on("data", (chunk) => {
  append(errFile, chunk);
  process.stderr.write(chunk);
});

child.on("error", (err) => {
  const message = `${err instanceof Error ? err.stack || err.message : String(err)}\n`;
  append(errFile, message);
  process.stderr.write(message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 1);
});
