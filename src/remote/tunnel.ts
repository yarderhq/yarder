import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { AGENT_PORT } from "../config/constants.ts";
import { getRemote, upsertRemote, type RemoteRecord } from "./remotes.ts";
import { openSshTunnel, parseSshTarget, waitForTunnel } from "./ssh.ts";

const tunnels = new Map<string, { child: ChildProcess; localPort: number }>();

export async function findFreePort(preferred?: number): Promise<number> {
  if (preferred) {
    const free = await isFree(preferred);
    if (free) return preferred;
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((err) => {
        if (err) reject(err);
        else if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not allocate a local tunnel port"));
      });
    });
    server.on("error", reject);
  });
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

export async function ensureTunnel(name: string, remote?: RemoteRecord): Promise<{ localPort: number; url: string }> {
  const record = remote ?? getRemote(name);
  if (!record) throw new Error(`Unknown remote "${name}". Run: yarder remote add ${name} user@host`);
  const existing = tunnels.get(name);
  if (existing && !existing.child.killed) {
    return { localPort: existing.localPort, url: `http://127.0.0.1:${existing.localPort}` };
  }

  const localPort = await findFreePort(record.localTunnelPort || 13847);
  if (localPort !== record.localTunnelPort) {
    upsertRemote(name, { ...record, localTunnelPort: localPort });
  }
  const target = parseSshTarget(record.ssh, record.port);
  const child = openSshTunnel(target, localPort, record.agentPort || AGENT_PORT);
  child.on("exit", () => {
    const current = tunnels.get(name);
    if (current?.child === child) tunnels.delete(name);
  });
  tunnels.set(name, { child, localPort });
  try {
    await waitForTunnel(localPort);
  } catch (err) {
    child.kill();
    tunnels.delete(name);
    throw err;
  }
  return { localPort, url: `http://127.0.0.1:${localPort}` };
}

export function closeTunnel(name: string): void {
  const current = tunnels.get(name);
  if (!current) return;
  current.child.kill();
  tunnels.delete(name);
}

export function closeAllTunnels(): void {
  for (const name of [...tunnels.keys()]) {
    closeTunnel(name);
  }
}
