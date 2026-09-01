import { spawnSync } from "node:child_process";
import type { RunOptions, RunResult, Runner } from "./types.ts";

export const defaultRun: Runner = (command, args = [], opts = {}) => {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: opts.inheritStdio ? undefined : "utf8",
    stdio: opts.inheritStdio ? "inherit" : undefined,
    windowsHide: true,
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return {
    status: result.status,
    stdout,
    stderr: stderr || (result.error ? result.error.message : ""),
  };
};

export function defaultWhich(bin: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [bin], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  const line = result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line || null;
}

export function output(result: RunResult): string {
  return `${result.stdout}\n${result.stderr}`;
}
