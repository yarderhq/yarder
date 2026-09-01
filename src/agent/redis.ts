import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ResolvedRedisService } from "../config/resolve.ts";

export type RedisBinaries = {
  server: string;
  cli: string;
};

function which(bin: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(cmd, [bin], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const line = result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line || null;
}

const extraDirs = [
  "/opt/homebrew/opt/redis/bin",
  "/opt/homebrew/bin",
  "/usr/local/opt/redis/bin",
  "/usr/local/bin",
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

export function findRedisBins(): RedisBinaries | null {
  const server = findBin("redis-server");
  const cli = findBin("redis-cli");
  if (!server || !cli) return null;
  return { server, cli };
}

export function redisMissingHint(): string {
  return "Redis binaries (redis-server, redis-cli) were not found on PATH. Install Redis and add its bin directory to PATH. yarder will not use Docker.";
}

function run(bin: string, args: string[]): void {
  const result = spawnSync(bin, args, { encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${bin} failed`).trim());
  }
}

export function ensureRedis(service: ResolvedRedisService): void {
  const bins = findRedisBins();
  if (!bins) {
    throw new Error(redisMissingHint());
  }

  fs.mkdirSync(service.dataDir, { recursive: true });
  const logFile = path.join(service.dataDir, "redis.log");
  const args = [
    "--port",
    String(service.port),
    "--bind",
    "127.0.0.1",
    "--dir",
    service.dataDir,
    "--dbfilename",
    "dump.rdb",
    "--pidfile",
    service.pidFile,
    "--logfile",
    logFile,
    "--protected-mode",
    "yes",
  ];

  if (redisReady(service)) return;

  if (process.platform === "win32") {
    const child = spawn(bins.server, args, { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    return;
  }

  run(bins.server, [...args, "--daemonize", "yes"]);
}

export function stopRedis(service: ResolvedRedisService): void {
  const bins = findRedisBins();
  if (bins) {
    spawnSync(bins.cli, ["-h", "127.0.0.1", "-p", String(service.port), "SHUTDOWN"], { encoding: "utf8" });
  }
  if (fs.existsSync(service.pidFile)) {
    try {
      const pid = Number(fs.readFileSync(service.pidFile, "utf8").trim());
      if (pid) process.kill(pid);
    } catch {
      // Already gone.
    }
  }
}

export function redisRunning(service: ResolvedRedisService): boolean {
  return redisReady(service);
}

export function redisReady(service: ResolvedRedisService): boolean {
  const bins = findRedisBins();
  if (!bins) return false;
  const result = spawnSync(bins.cli, ["-h", "127.0.0.1", "-p", String(service.port), "PING"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().toUpperCase() === "PONG";
}
