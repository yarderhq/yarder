import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pm2 from "pm2";
import { PM2_PREFIX, slugify } from "../config/constants.ts";
import { nodeBinPathPrefix } from "../config/port-command.ts";
import type { ResolvedAppService, ResolvedProject } from "../config/resolve.ts";

const runServiceJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/run-service.js");

export type ProcessStatus = {
  name: string;
  status: string;
  cpu: number;
  memory: number;
  pmId: number | null;
};

function procName(project: string, service: string): string {
  return `${PM2_PREFIX}-${slugify(project)}-${slugify(service)}`;
}

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function prependPath(env: Record<string, string>, prefix: string): void {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  env[key] = env[key] ? `${prefix}${path.delimiter}${env[key]}` : prefix;
}

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

let connected = false;

export async function ensurePm2(): Promise<void> {
  if (connected) return;
  await connect();
  connected = true;
}

export async function disconnectPm2(): Promise<void> {
  if (!connected) return;
  pm2.disconnect();
  connected = false;
}

export async function startAppService(project: ResolvedProject, service: ResolvedAppService): Promise<void> {
  await ensurePm2();
  const name = procName(project.name, service.name);

  await stopAppService(project, service.name).catch(() => undefined);

  const logFiles = serviceLogPaths(project, service.name);
  fs.mkdirSync(logFiles.dir, { recursive: true });

  const env = { ...inheritedEnv(), ...service.env };
  const bins = nodeBinPathPrefix(service.dir);
  if (bins) {
    prependPath(env, bins);
  }

  const startOpts = {
    name,
    script: process.execPath,
    args: [runServiceJs],
    cwd: service.dir,
    env: {
      ...env,
      YARDER_RUN_COMMAND: service.command,
      YARDER_RUN_CWD: service.dir,
      YARDER_LOG_OUT: logFiles.out,
      YARDER_LOG_ERR: logFiles.err,
    },
    interpreter: "none",
    autorestart: project.envName === "production",
    watch: false,
  };

  await new Promise<void>((resolve, reject) => {
    pm2.start(startOpts as unknown as pm2.StartOptions, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function stopAppService(project: ResolvedProject, serviceName: string): Promise<void> {
  await ensurePm2();
  const name = procName(project.name, serviceName);
  await new Promise<void>((resolve) => {
    pm2.stop(name, () => {
      pm2.delete(name, () => resolve());
    });
  });
}

export async function listStatuses(project: ResolvedProject): Promise<Record<string, ProcessStatus>> {
  await ensurePm2();
  const list = await new Promise<Array<{ name?: string; pm2_env?: { status?: string }; monit?: { cpu?: number; memory?: number }; pm_id?: number }>>((resolve, reject) => {
    pm2.list((err, procs) => {
      if (err) reject(err);
      else resolve(procs);
    });
  });

  const byName = new Map(list.map((proc) => [proc.name, proc]));
  const statuses: Record<string, ProcessStatus> = {};

  for (const service of Object.values(project.services)) {
    if (service.kind !== "process") continue;
    const proc = byName.get(procName(project.name, service.name));
    statuses[service.name] = {
      name: service.name,
      status: proc?.pm2_env?.status ?? "stopped",
      cpu: proc?.monit?.cpu ?? 0,
      memory: proc?.monit?.memory ?? 0,
      pmId: proc?.pm_id ?? null,
    };
  }

  return statuses;
}

export function serviceLogPaths(project: ResolvedProject, serviceName: string): { dir: string; out: string; err: string } {
  const dir = path.join(project.runtimeDir, "logs");
  const slug = slugify(serviceName);
  return {
    dir,
    out: path.join(dir, `${slug}-out.log`),
    err: path.join(dir, `${slug}-error.log`),
  };
}

export async function readServiceLogTail(
  project: ResolvedProject,
  serviceName: string,
  maxBytes = 8192,
): Promise<string[]> {
  const files = serviceLogPaths(project, serviceName);
  const paths = [files.err, files.out];

  await ensurePm2();
  const name = procName(project.name, serviceName);
  const proc = await new Promise<{ pm2_env?: { pm_out_log_path?: string; pm_err_log_path?: string } } | undefined>(
    (resolve, reject) => {
      pm2.describe(name, (err, procs) => {
        if (err) reject(err);
        else resolve(procs?.[0]);
      });
    },
  ).catch(() => undefined);
  if (proc?.pm2_env?.pm_err_log_path) paths.push(proc.pm2_env.pm_err_log_path);
  if (proc?.pm2_env?.pm_out_log_path) paths.push(proc.pm2_env.pm_out_log_path);

  const lines: string[] = [];
  const seenFiles = new Set<string>();
  for (const file of paths) {
    const resolved = path.resolve(file);
    if (seenFiles.has(resolved)) continue;
    seenFiles.add(resolved);
    lines.push(...readLogLines(file, maxBytes));
  }
  return lines.slice(-40);
}

function readLogLines(file: string, maxBytes: number): string[] {
  if (!fs.existsSync(file)) return [];
  const buf = fs.readFileSync(file, "utf8");
  const slice = buf.length > maxBytes ? buf.slice(-maxBytes) : buf;
  return slice.split(/\r?\n/).filter((line) => line.trim());
}

export function matchesyarderProcess(project: string, pm2Name: string | undefined): string | null {
  if (!pm2Name) return null;
  const prefix = `${PM2_PREFIX}-${slugify(project)}-`;
  if (!pm2Name.startsWith(prefix)) return null;
  return pm2Name.slice(prefix.length);
}

export async function deleteAllyarderProcesses(): Promise<string[]> {
  await ensurePm2();
  const list = await new Promise<Array<{ name?: string }>>((resolve, reject) => {
    pm2.list((err, procs) => {
      if (err) reject(err);
      else resolve(procs);
    });
  });
  const prefix = `${PM2_PREFIX}-`;
  const removed: string[] = [];
  for (const proc of list) {
    if (!proc.name?.startsWith(prefix)) continue;
    await new Promise<void>((resolve) => {
      pm2.stop(proc.name!, () => {
        pm2.delete(proc.name!, () => resolve());
      });
    });
    removed.push(proc.name);
  }
  await disconnectPm2();
  return removed;
}
