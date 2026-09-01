import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ResolvedPostgresService } from "../config/resolve.ts";

export type Binaries = {
  initdb: string;
  pg_ctl: string;
  psql: string;
  createdb: string;
};

function which(bin: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [bin], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const line = result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line || null;
}

const extraDirs = [
  "/usr/lib/postgresql/16/bin",
  "/usr/lib/postgresql/15/bin",
  "/usr/lib/postgresql/14/bin",
  "/opt/homebrew/opt/postgresql@16/bin",
  "/opt/homebrew/opt/postgresql@15/bin",
  "/usr/local/opt/postgresql@16/bin",
];

function findBin(name: string): string | null {
  const onPath = which(name);
  if (onPath) return onPath;
  for (const dir of extraDirs) {
    const candidate = path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function findPostgresBins(): Binaries | null {
  const initdb = findBin("initdb");
  const pg_ctl = findBin("pg_ctl");
  const psql = findBin("psql");
  const createdb = findBin("createdb");
  if (!initdb || !pg_ctl || !psql || !createdb) return null;
  return { initdb, pg_ctl, psql, createdb };
}

export function postgresMissingHint(): string {
  return "PostgreSQL binaries (initdb, pg_ctl, psql, createdb) were not found on PATH. Install PostgreSQL and add its bin directory to PATH. yarder will not use Docker.";
}

function run(bin: string, args: string[], opts: { env?: NodeJS.ProcessEnv } = {}): void {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${bin} failed`).trim());
  }
}

export function ensurePostgres(service: ResolvedPostgresService): void {
  const bins = findPostgresBins();
  if (!bins) {
    throw new Error(postgresMissingHint());
  }

  fs.mkdirSync(path.dirname(service.dataDir), { recursive: true });
  const logFile = path.join(path.dirname(service.dataDir), `${service.name}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  if (!fs.existsSync(path.join(service.dataDir, "PG_VERSION"))) {
    run(bins.initdb, ["-D", service.dataDir, "--auth=trust", "--username=yarder"]);
  }

  const status = spawnSync(bins.pg_ctl, ["-D", service.dataDir, "status"], { encoding: "utf8" });
  if (status.status !== 0) {
    run(bins.pg_ctl, [
      "-D",
      service.dataDir,
      "-l",
      logFile,
      "-o",
      `-p ${service.port}`,
      "start",
    ]);
  }

  const exists = spawnSync(
    bins.psql,
    ["-h", "127.0.0.1", "-p", String(service.port), "-U", "yarder", "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${service.database}'`],
    { encoding: "utf8" },
  );
  if (!exists.stdout.trim().startsWith("1")) {
    run(bins.createdb, ["-h", "127.0.0.1", "-p", String(service.port), "-U", "yarder", service.database]);
  }
}

export function stopPostgres(service: ResolvedPostgresService): void {
  const bins = findPostgresBins();
  if (!bins || !fs.existsSync(service.dataDir)) return;
  spawnSync(bins.pg_ctl, ["-D", service.dataDir, "-m", "fast", "stop"], { encoding: "utf8" });
}

export function postgresRunning(service: ResolvedPostgresService): boolean {
  const bins = findPostgresBins();
  if (!bins || !fs.existsSync(service.dataDir)) return false;
  const status = spawnSync(bins.pg_ctl, ["-D", service.dataDir, "status"], { encoding: "utf8" });
  return status.status === 0;
}

export function postgresReady(service: ResolvedPostgresService): boolean {
  const bins = findPostgresBins();
  if (!bins) return false;
  const pgIsReady = findBin("pg_isready");
  if (pgIsReady) {
    const result = spawnSync(
      pgIsReady,
      ["-h", "127.0.0.1", "-p", String(service.port), "-U", "yarder"],
      { encoding: "utf8" },
    );
    return result.status === 0;
  }
  const result = spawnSync(
    bins.psql,
    ["-h", "127.0.0.1", "-p", String(service.port), "-U", "yarder", "-d", service.database, "-tAc", "SELECT 1"],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout.trim().startsWith("1");
}

export function openDbShell(service: ResolvedPostgresService): ChildProcess {
  const bins = findPostgresBins();
  if (!bins) {
    throw new Error(postgresMissingHint());
  }
  return spawn(bins.psql, ["-h", "127.0.0.1", "-p", String(service.port), "-U", "yarder", "-d", service.database], {
    stdio: "inherit",
    env: process.env,
  });
}
