import { spawn } from "node:child_process";
import path from "node:path";
import { findConfigFile, loadConfig } from "../config/load.ts";
import { resolveProject } from "../config/resolve.ts";
import { installBuildExcludes } from "../agent/deploy.ts";
import { remoteAppDir, type RemoteRecord } from "./remotes.ts";
import { parseSshTarget, shQuote, sshBaseArgs, type SshTarget } from "./ssh.ts";

export const SYNC_EXCLUDES = ["node_modules", ".git", ".yarder/data", ".yarder/nginx"];

export function tarExcludeArgs(excludes: string[]): string[] {
  return excludes.flatMap((item) => ["--exclude", item]);
}

function resolveExcludes(localRoot: string): string[] {
  const configPath = findConfigFile(localRoot);
  if (!configPath) return [...SYNC_EXCLUDES];
  try {
    const config = loadConfig(configPath);
    const project = resolveProject(config, localRoot, { envName: "production" });
    return installBuildExcludes(project);
  } catch {
    return [...SYNC_EXCLUDES];
  }
}

export async function syncProject(target: SshTarget, localRoot: string, remoteDir: string): Promise<void> {
  const excludes = resolveExcludes(localRoot);
  await new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["-cf", "-", ...tarExcludeArgs(excludes), "."], {
      cwd: localRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const remote = `mkdir -p ${shQuote(remoteDir)} && tar -xf - -C ${shQuote(remoteDir)}`;
    const ssh = spawn("ssh", sshBaseArgs(target, [remote]), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    tar.stdout.pipe(ssh.stdin);
    let err = "";
    tar.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    ssh.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    tar.on("error", reject);
    ssh.on("error", reject);
    ssh.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `project sync failed (${code})`));
    });
  });
}

export function localProjectRoot(cwd = process.cwd()): { root: string; name: string } {
  const configPath = findConfigFile(cwd);
  if (!configPath) {
    throw new Error(`No yarder.yaml found from ${cwd}`);
  }
  const config = loadConfig(configPath);
  return { root: path.dirname(path.resolve(configPath)), name: config.name };
}

export function destinationFor(remote: RemoteRecord, projectName: string): { target: SshTarget; dir: string } {
  return {
    target: parseSshTarget(remote.ssh, remote.port),
    dir: remoteAppDir(remote, projectName),
  };
}
