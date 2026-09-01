import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startOrder, type ResolvedProject } from "../config/resolve.ts";
import { applyTls, type TlsView } from "./certbot.ts";
import { startOne, stopOne } from "./lifecycle.ts";
import { applyRouting, type RoutingResult } from "./nginx.ts";
import { postgresRunning } from "./postgres.ts";
import { redisRunning } from "./redis.ts";

export function defaultInstallCommand(dir: string): string | undefined {
  if (!fs.existsSync(path.join(dir, "package.json"))) return undefined;
  if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm ci";
  return "npm install";
}

export function runShell(command: string, cwd: string): { status: number | null; output: string } {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { status: result.status, output };
}

export function installBuildExcludes(project: ResolvedProject): string[] {
  const excludes = ["node_modules", ".git", ".yarder/data", ".yarder/nginx"];
  const hasBuild = Object.values(project.services).some((service) => service.kind === "process" && service.build);
  if (hasBuild) excludes.push("dist");
  return excludes;
}

export async function runInstallAndBuild(project: ResolvedProject): Promise<string[]> {
  const lines: string[] = [];
  for (const name of startOrder(project)) {
    const service = project.services[name];
    if (!service || service.kind !== "process") continue;
    const install = service.install ?? defaultInstallCommand(service.dir);
    if (install) {
      lines.push(`[${name}] ${install}`);
      const result = runShell(install, service.dir);
      if (result.output) lines.push(result.output);
      if (result.status !== 0) {
        throw new Error(`install failed for ${name}: ${result.output || `exit ${result.status}`}`);
      }
    }
    if (service.build) {
      lines.push(`[${name}] ${service.build}`);
      const result = runShell(service.build, service.dir);
      if (result.output) lines.push(result.output);
      if (result.status !== 0) {
        throw new Error(`build failed for ${name}: ${result.output || `exit ${result.status}`}`);
      }
    }
  }
  return lines;
}

export async function deployStack(project: ResolvedProject): Promise<{
  routing: RoutingResult;
  buildLog: string[];
  tls: TlsView;
}> {
  const buildLog = await runInstallAndBuild(project);
  const started: string[] = [];
  try {
    for (const name of startOrder(project)) {
      const service = project.services[name];
      if (!service) continue;
      if (service.kind === "postgres") {
        if (!postgresRunning(service)) await startOne(project, name);
        continue;
      }
      if (service.kind === "redis") {
        if (!redisRunning(service)) await startOne(project, name);
        continue;
      }
      await stopOne(project, name).catch(() => undefined);
      await startOne(project, name);
      started.push(name);
    }
  } catch (err) {
    for (const name of [...started].reverse()) {
      await stopOne(project, name).catch(() => undefined);
    }
    throw err;
  }
  let routing = applyRouting(project);
  const tls = await applyTls(project);
  if (tls.status === "active") {
    routing = applyRouting(project);
  }
  return { routing, buildLog, tls };
}
