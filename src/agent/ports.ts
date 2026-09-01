import net from "node:net";
import type { ResolvedProject, ResolvedService } from "../config/resolve.ts";
import { listStatuses } from "./pm2.ts";
import { postgresRunning } from "./postgres.ts";
import { redisRunning } from "./redis.ts";

export function declaredPorts(project: ResolvedProject): { name: string; port: number }[] {
  const ports: { name: string; port: number }[] = [];
  for (const service of Object.values(project.services)) {
    if (service.port) {
      ports.push({ name: service.name, port: service.port });
    }
  }
  return ports;
}

export function assertNoDuplicatePorts(project: ResolvedProject): void {
  const seen = new Map<number, string>();
  for (const { name, port } of declaredPorts(project)) {
    const existing = seen.get(port);
    if (existing) {
      throw new Error(`${name} port ${port} is already used by ${existing}`);
    }
    seen.set(port, name);
  }
}

export function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, host);
  });
}

export async function assertPortsAvailable(project: ResolvedProject): Promise<void> {
  assertNoDuplicatePorts(project);
  const pm2Status = await listStatuses(project).catch(() => ({}));
  for (const service of Object.values(project.services)) {
    if (await isOurPort(service, pm2Status)) continue;
    if (service.port && (await isPortInUse(service.port))) {
      throw new Error(`${service.name} port ${service.port} is already in use`);
    }
  }
}

async function isOurPort(
  service: ResolvedService,
  pm2Status: Awaited<ReturnType<typeof listStatuses>>,
): Promise<boolean> {
  if (!service.port) return true;
  if (service.kind === "process") {
    return pm2Status[service.name]?.status === "online";
  }
  if (service.kind === "postgres") {
    return postgresRunning(service);
  }
  return redisRunning(service);
}
