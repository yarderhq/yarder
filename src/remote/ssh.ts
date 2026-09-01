import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { tcpReady } from "../agent/health.ts";

export type SshTarget = {
  user: string;
  host: string;
  port?: number;
};

export type SshResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function parseSshTarget(value: string, port?: number): SshTarget {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    throw new Error(`Invalid SSH target "${value}". Use user@host`);
  }
  let host = trimmed.slice(at + 1);
  let parsedPort = port;
  const colon = host.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
    parsedPort = Number(host.slice(colon + 1));
    host = host.slice(0, colon);
  }
  return { user: trimmed.slice(0, at), host, port: parsedPort };
}

export function formatSshTarget(target: SshTarget): string {
  return target.port ? `${target.user}@${target.host}:${target.port}` : `${target.user}@${target.host}`;
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sshBaseArgs(target: SshTarget, extra: string[] = []): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
  ];
  if (target.port) {
    args.push("-p", String(target.port));
  }
  args.push(...extra, `${target.user}@${target.host}`);
  return args;
}

function requireBin(bin: string, hint: string): void {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [bin], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(hint);
  }
}

export function assertSshAvailable(): void {
  requireBin("ssh", "OpenSSH is required for yarder deploy. Install the OpenSSH client and retry.");
}

export function sshExec(
  target: SshTarget,
  command: string,
  opts: { inheritStdio?: boolean } = {},
): SshResult {
  assertSshAvailable();
  const result = spawnSync("ssh", sshBaseArgs(target, [command]), {
    encoding: opts.inheritStdio ? undefined : "utf8",
    stdio: opts.inheritStdio ? "inherit" : undefined,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : result.error?.message ?? "",
  };
}

export function sshExecOrThrow(target: SshTarget, command: string, opts: { inheritStdio?: boolean } = {}): string {
  const result = sshExec(target, command, opts);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `ssh failed (${result.status})`);
  }
  return result.stdout;
}

export function scpUpload(target: SshTarget, localPath: string, remotePath: string): void {
  assertSshAvailable();
  const args = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
  if (target.port) args.push("-P", String(target.port));
  args.push(localPath, `${target.user}@${target.host}:${remotePath}`);
  const result = spawnSync("scp", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "scp failed").trim());
  }
}

export function openSshTunnel(target: SshTarget, localPort: number, remotePort: number): ChildProcess {
  assertSshAvailable();
  const child = spawn(
    "ssh",
    sshBaseArgs(target, [
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    ]),
    { stdio: "ignore", windowsHide: true },
  );
  return child;
}

export async function waitForTunnel(localPort: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpReady(localPort, "127.0.0.1")) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`SSH tunnel did not become ready on 127.0.0.1:${localPort}`);
}
