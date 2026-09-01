import { AgentClient } from "./client.ts";
import { defaultRemoteName, getRemote, type RemoteRecord } from "../remote/remotes.ts";
import { closeTunnel, ensureTunnel } from "../remote/tunnel.ts";

export type EnvSession = {
  name: string;
  client: AgentClient;
  remote?: RemoteRecord;
  close: () => void;
};

export async function connectEnv(envName?: string): Promise<EnvSession> {
  const name = envName && envName !== "local" ? envName : "local";
  if (name === "local") {
    return {
      name: "local",
      client: new AgentClient(),
      close: () => undefined,
    };
  }
  const remote = getRemote(name);
  if (!remote) {
    const hint = defaultRemoteName();
    throw new Error(
      `Unknown environment "${name}". ${hint ? `Known remotes: ${hint}. ` : ""}Run: yarder remote add ${name} user@host`,
    );
  }
  const tunnel = await ensureTunnel(name, remote);
  const client = new AgentClient({ baseUrl: tunnel.url, token: remote.token });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (await client.health()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!(await client.health())) {
    closeTunnel(name);
    throw new Error(`Remote agent is not reachable via SSH tunnel (${tunnel.url}). Is yarder-agent running on the server?`);
  }
  return {
    name,
    client,
    remote,
    close: () => closeTunnel(name),
  };
}
