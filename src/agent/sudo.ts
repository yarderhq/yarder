import { spawnSync } from "node:child_process";

export type PrivilegedResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function runPrivileged(command: string, args: string[] = []): PrivilegedResult {
  const direct = spawnSync(command, args, { encoding: "utf8" });
  if (direct.error?.message.includes("ENOENT")) {
    return { status: 127, stdout: "", stderr: direct.error.message };
  }
  if (direct.status === 0) {
    return { status: 0, stdout: direct.stdout ?? "", stderr: direct.stderr ?? "" };
  }
  const sudo = spawnSync("sudo", ["-n", command, ...args], { encoding: "utf8" });
  if (sudo.error?.message.includes("ENOENT")) {
    return {
      status: direct.status,
      stdout: direct.stdout ?? "",
      stderr: (direct.stderr || sudo.error.message).trim(),
    };
  }
  return {
    status: sudo.status,
    stdout: `${direct.stdout ?? ""}${sudo.stdout ?? ""}`,
    stderr: (sudo.stderr || direct.stderr || "").trim(),
  };
}

export function privilegedOutput(result: PrivilegedResult): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}
