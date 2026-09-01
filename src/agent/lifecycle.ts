import fs from "node:fs";
import { describeServiceEnv, startOrder, type ResolvedProject, type ResolvedService } from "../config/resolve.ts";
import type { EnvVarView } from "../config/env.ts";
import { probeHealth, waitUntilHealthy, type HealthStatus } from "./health.ts";
import { applyRouting, type RoutingResult } from "./nginx.ts";
import { listStatuses, startAppService, stopAppService, type ProcessStatus } from "./pm2.ts";
import { assertPortsAvailable } from "./ports.ts";
import { ensurePostgres, postgresRunning, stopPostgres } from "./postgres.ts";
import { ensureRedis, redisRunning, stopRedis } from "./redis.ts";

export type ServiceView = {
  name: string;
  kind: "process" | "postgres" | "redis";
  status: string;
  health: HealthStatus;
  port?: number;
  hostname?: string;
  url?: string;
  command?: string;
  memory?: number;
  cpu?: number;
  env: Record<string, EnvVarView>;
};

export async function startStack(project: ResolvedProject): Promise<{ routing: RoutingResult }> {
  fs.mkdirSync(project.runtimeDir, { recursive: true });
  await assertPortsAvailable(project);
  const started: string[] = [];
  try {
    for (const name of startOrder(project)) {
      const service = project.services[name];
      if (!service) continue;
      await startService(project, service);
      started.push(name);
      await waitUntilHealthy(project, service);
    }
  } catch (err) {
    for (const name of [...started].reverse()) {
      await stopOne(project, name).catch(() => undefined);
    }
    throw err;
  }
  const routing = applyRouting(project);
  return { routing };
}

export async function stopStack(project: ResolvedProject): Promise<void> {
  for (const name of [...startOrder(project)].reverse()) {
    await stopOne(project, name);
  }
}

export async function restartStack(project: ResolvedProject): Promise<{ routing: RoutingResult }> {
  await stopStack(project);
  return startStack(project);
}

export async function restartService(project: ResolvedProject, name: string): Promise<void> {
  await stopOne(project, name);
  await startOne(project, name);
}

export async function startOne(project: ResolvedProject, name: string): Promise<void> {
  const service = project.services[name];
  if (!service) throw new Error(`Unknown service "${name}"`);
  await startService(project, service);
  await waitUntilHealthy(project, service);
}

export async function stopOne(project: ResolvedProject, name: string): Promise<void> {
  const service = project.services[name];
  if (!service) throw new Error(`Unknown service "${name}"`);
  if (service.kind === "postgres") {
    stopPostgres(service);
    return;
  }
  if (service.kind === "redis") {
    stopRedis(service);
    return;
  }
  await stopAppService(project, name);
}

export async function projectStatus(project: ResolvedProject): Promise<ServiceView[]> {
  const pm2Status = await listStatuses(project);
  const views: ServiceView[] = [];
  for (const service of Object.values(project.services)) {
    views.push(await toServiceView(project, service, pm2Status));
  }
  return views;
}

async function startService(project: ResolvedProject, service: ResolvedService): Promise<void> {
  if (service.kind === "postgres") {
    ensurePostgres(service);
    return;
  }
  if (service.kind === "redis") {
    ensureRedis(service);
    return;
  }
  await startAppService(project, service);
}

async function toServiceView(
  project: ResolvedProject,
  service: ResolvedService,
  pm2Status: Record<string, ProcessStatus>,
): Promise<ServiceView> {
  const env = describeServiceEnv(service);
  if (service.kind === "postgres") {
    const online = postgresRunning(service);
    return {
      name: service.name,
      kind: "postgres",
      status: online ? "online" : "stopped",
      health: await healthFor(project, service, online),
      port: service.port,
      url: service.databaseUrl,
      env,
    };
  }
  if (service.kind === "redis") {
    const online = redisRunning(service);
    return {
      name: service.name,
      kind: "redis",
      status: online ? "online" : "stopped",
      health: await healthFor(project, service, online),
      port: service.port,
      url: service.redisUrl,
      env,
    };
  }
  const status: ProcessStatus | undefined = pm2Status[service.name];
  const online = status?.status === "online";
  return {
    name: service.name,
    kind: "process",
    status: status?.status ?? "stopped",
    health: await healthFor(project, service, online),
    port: service.port,
    hostname: service.hostname,
    url: service.url,
    command: service.command,
    memory: status?.memory,
    cpu: status?.cpu,
    env,
  };
}

async function healthFor(
  project: ResolvedProject,
  service: ResolvedService,
  online: boolean,
): Promise<HealthStatus> {
  if (!online) return "stopped";
  return (await probeHealth(project, service)) ? "healthy" : "unhealthy";
}
