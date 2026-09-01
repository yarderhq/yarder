import net from "node:net";
import { HEALTH_POLL_MS, HEALTH_TIMEOUT_MS } from "../config/constants.ts";
import type { ResolvedProject, ResolvedService } from "../config/resolve.ts";
import { emitSystemLog, recentLogs } from "./logs.ts";
import { listStatuses, readServiceLogTail } from "./pm2.ts";
import { postgresReady } from "./postgres.ts";
import { redisReady } from "./redis.ts";

export type HealthStatus = "healthy" | "starting" | "unhealthy" | "stopped";

const EXIT_GRACE_MS = 1_500;
const LOG_FLUSH_MS = 250;

export class UnhealthyServiceError extends Error {
  constructor(
    readonly service: string,
    readonly status: string | undefined,
    readonly logs: string[],
  ) {
    super(formatUnhealthyError(service, status, logs));
    this.name = "UnhealthyServiceError";
  }
}

export async function probeHealth(project: ResolvedProject, service: ResolvedService): Promise<boolean> {
  if (service.kind === "postgres") return postgresReady(service);
  if (service.kind === "redis") return redisReady(service);
  if (service.health && service.port) {
    return httpReady(service.port, service.health);
  }
  if (service.port) {
    return tcpReady(service.port);
  }
  const statuses = await listStatuses(project);
  return statuses[service.name]?.status === "online";
}

export async function waitUntilHealthy(project: ResolvedProject, service: ResolvedService): Promise<void> {
  emitSystemLog(service.name, "waiting until healthy");
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    if (await probeHealth(project, service)) {
      emitSystemLog(service.name, "healthy");
      return;
    }
    if (service.kind === "process" && Date.now() - startedAt >= EXIT_GRACE_MS) {
      const statuses = await listStatuses(project);
      const status = statuses[service.name]?.status ?? "stopped";
      if (status !== "online" && status !== "launching") {
        throw await unhealthyError(project, service, status);
      }
    }
    await sleep(HEALTH_POLL_MS);
  }
  const statuses = await listStatuses(project);
  throw await unhealthyError(project, service, statuses[service.name]?.status);
}

export function formatUnhealthyError(name: string, status: string | undefined, logs: string[]): string {
  const statusPart = status ? ` (status: ${status})` : "";
  const logPart = logs.length > 0 ? `\n\n${logs.join("\n")}` : "\n\nNo process logs were captured.";
  return `${name} did not become healthy${statusPart}.${logPart}`;
}

export function startFailurePayload(err: unknown): { error: string; logs: string[] } {
  if (err instanceof UnhealthyServiceError) {
    return {
      error: `${err.service} did not become healthy${err.status ? ` (status: ${err.status})` : ""}.`,
      logs: err.logs.length > 0 ? err.logs : ["No process logs were captured."],
    };
  }
  return {
    error: err instanceof Error ? err.message : String(err),
    logs: recentLogs(undefined, 40).map((entry) => `[${entry.service}] ${entry.line}`),
  };
}

export function tcpReady(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
  });
}

async function unhealthyError(
  project: ResolvedProject,
  service: ResolvedService,
  status: string | undefined,
): Promise<UnhealthyServiceError> {
  await sleep(LOG_FLUSH_MS);
  const fromBus = recentLogs(service.name, 40).map((entry) => entry.line);
  const fromFiles = service.kind === "process" ? await readServiceLogTail(project, service.name) : [];
  const logs = uniqueTail([...fromBus, ...fromFiles], 40);
  return new UnhealthyServiceError(service.name, status, logs);
}

async function httpReady(port: number, healthPath: string): Promise<boolean> {
  const pathname = healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function uniqueTail(lines: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out.slice(-limit);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
