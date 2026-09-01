import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { FastifyInstance } from "fastify";
import { listenAgent } from "../agent/app.ts";
import { restoreProject } from "../agent/persist.ts";
import { deleteAllyarderProcesses } from "../agent/pm2.ts";
import { openDbShell } from "../agent/postgres.ts";
import { getProjectOrNull } from "../agent/state.ts";
import { AGENT_PORT, agentBaseUrl, CONFIG_FILENAME, yarderEnv } from "../config/constants.ts";
import { guessInitConfig, writeConfig } from "../config/load.ts";
import type { EnvVarView } from "../config/env.ts";
import { AgentClient } from "./client.ts";
import { connectEnv } from "./connect.ts";
import { addRemote } from "../remote/provision.ts";
import { defaultRemoteName, getRemote, loadRemotes, removeRemote, upsertRemote } from "../remote/remotes.ts";
import { destinationFor, localProjectRoot, syncProject } from "../remote/sync.ts";
import { parseSshTarget } from "../remote/ssh.ts";
import { runSetup } from "../setup/index.ts";

type ServiceView = {
  name: string;
  kind: string;
  status: string;
  health?: string;
  port?: number;
  hostname?: string;
  url?: string;
  memory?: number;
};

type TlsView = {
  status?: string;
  message?: string;
  expiry?: string;
  hosts?: string[];
};

const pkg = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"),
) as { version: string };

const program = new Command();
program.name("yarder").description("Run your stack locally. Deploy it anywhere you own.").version(pkg.version);

const envOption = { flags: "-e, --env <name>", description: "target environment (local or a remote name)", default: "local" };

program
  .command("init")
  .description("Write a yarder.yaml in the current directory")
  .action(() => {
    const dest = path.join(process.cwd(), CONFIG_FILENAME);
    if (fs.existsSync(dest)) {
      console.error(`${CONFIG_FILENAME} already exists`);
      process.exitCode = 1;
      return;
    }
    writeConfig(dest, guessInitConfig(process.cwd()));
    console.log(`Wrote ${dest}`);
  });

program
  .command("setup")
  .description("Install local dependencies for yarder dev (WSL2 on Windows; nginx, Postgres, Redis)")
  .option("--check", "Probe only; do not install")
  .action((opts: { check?: boolean }) => {
    process.exitCode = runSetup({ checkOnly: Boolean(opts.check) });
  });

program
  .command("agent")
  .description("Run the yarder agent daemon")
  .option("--port <port>", "listen port")
  .action(async (opts: { port?: string }) => {
    if (process.env.YARDER_ENV === "production") {
      process.env.NODE_ENV ??= "production";
    }
    restoreProject();
    const port = Number(opts.port ?? AGENT_PORT);
    const app = await listenAgent(port);
    const restored = getProjectOrNull();
    console.log(`yarder agent listening on ${agentBaseUrl(port)} (${yarderEnv()})`);
    if (restored) {
      console.log(`Loaded ${restored.config.name} from ${restored.root}`);
    }
    await new Promise<void>((resolve) => {
      const stop = () => {
        void app.close().finally(resolve);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  });

program
  .command("dev")
  .description("Load yarder.yaml, start the local agent, and run the stack")
  .action(async () => {
    const client = new AgentClient();
    let app: FastifyInstance | undefined;
    const startedAgent = !(await client.health());
    if (startedAgent) {
      app = await listenAgent(AGENT_PORT);
    }
    const logs = openLogStream(client, undefined, true);
    try {
      await logs.ready;
      await client.request("POST", "/api/project/load", { root: process.cwd() });
      const started = await client.request<{
        routing?: { skipped?: string; warning?: string; hosts?: string[] };
        services: ServiceView[];
      }>("POST", "/api/dev/start");
      printRouting(started.routing);
      printServices(started.services);
      console.log(`\nGUI: ${agentBaseUrl()}`);
      await logs.done;
      if (app) {
        await app.close();
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      await logs.shutdown();
      if (app) {
        await app.close();
      }
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show service status")
  .option(envOption.flags, envOption.description, envOption.default)
  .action(async (opts: { env?: string }) => {
    const session = await requireAgent(opts.env);
    try {
      const data = await session.client.request<{ services: ServiceView[]; tls?: TlsView; env?: string }>(
        "GET",
        "/api/status",
      );
      if (data.env) console.log(`Environment: ${data.env}`);
      printServices(data.services);
      printTls(data.tls);
    } finally {
      session.close();
    }
  });

program
  .command("stop")
  .argument("[service]", "service name, or omit to stop the stack")
  .description("Stop one service or the whole stack")
  .option("--force", "Delete any yarder PM2 processes even if the agent is not running")
  .option(envOption.flags, envOption.description, envOption.default)
  .action(async (service: string | undefined, opts: { force?: boolean; env?: string }) => {
    if (opts.force && !service) {
      const removed = await deleteAllyarderProcesses();
      if (removed.length === 0) {
        console.log("No yarder PM2 processes found.");
      } else {
        console.log(`Removed: ${removed.join(", ")}`);
      }
      return;
    }
    const session = await requireAgent(opts.env);
    try {
      const data = service
        ? await session.client.request<{ services: ServiceView[] }>("POST", `/api/services/${encodeURIComponent(service)}/stop`)
        : await session.client.request<{ services: ServiceView[] }>("POST", "/api/dev/stop");
      printServices(data.services);
    } finally {
      session.close();
    }
  });

program
  .command("restart")
  .argument("[service]", "service name, or omit to restart the stack")
  .description("Restart one service or the whole stack")
  .option(envOption.flags, envOption.description, envOption.default)
  .action(async (service: string | undefined, opts: { env?: string }) => {
    const session = await requireAgent(opts.env);
    try {
      const data = service
        ? await session.client.request<{ services: ServiceView[] }>(
            "POST",
            `/api/services/${encodeURIComponent(service)}/restart`,
          )
        : await session.client.request<{ services: ServiceView[] }>("POST", "/api/dev/restart");
      printServices(data.services);
    } finally {
      session.close();
    }
  });

program
  .command("env")
  .description("Show injected and configured environment keys (secrets masked)")
  .option(envOption.flags, envOption.description, envOption.default)
  .action(async (opts: { env?: string }) => {
    const session = await requireAgent(opts.env);
    try {
      const data = await session.client.request<{ services: Record<string, Record<string, EnvVarView>> }>("GET", "/api/env");
      printEnv(data.services);
    } finally {
      session.close();
    }
  });

program
  .command("logs")
  .argument("[service]", "service name, or omit for all")
  .description("Stream logs")
  .option(envOption.flags, envOption.description, envOption.default)
  .action(async (service: string | undefined, opts: { env?: string }) => {
    const session = await requireAgent(opts.env);
    try {
      const data = await session.client.request<{ logs: { ts: string; service: string; stream: string; line: string }[] }>(
        "GET",
        `/api/logs${service ? `?service=${encodeURIComponent(service)}` : ""}`,
      );
      for (const entry of data.logs) {
        printLog(entry);
      }
      const logs = openLogStream(session.client, service, false);
      await logs.done;
    } finally {
      session.close();
    }
  });

program
  .command("deploy")
  .argument("[name]", "remote name")
  .description("Sync the project to a remote and reload it")
  .option("--domain <domain>", "production hostname base (e.g. example.com)")
  .action(async (name: string | undefined, opts: { domain?: string }) => {
    const remoteName = name || defaultRemoteName();
    if (!remoteName) {
      throw new Error("No remotes configured. Run: yarder remote add production user@host");
    }
    let remote = getRemote(remoteName);
    if (!remote) {
      throw new Error(`Unknown remote "${remoteName}". Run: yarder remote add ${remoteName} user@host`);
    }
    if (opts.domain && opts.domain !== remote.domain) {
      remote = { ...remote, domain: opts.domain };
      upsertRemote(remoteName, remote);
    }
    const local = localProjectRoot();
    const dest = destinationFor(remote, local.name);
    console.log(`Syncing ${local.root} → ${remote.ssh}:${dest.dir}`);
    await syncProject(dest.target, local.root, dest.dir);
    const session = await connectEnv(remoteName);
    try {
      await session.client.request("POST", "/api/project/load", {
        root: dest.dir,
        hostnameBase: remote.domain,
        urlScheme: "http",
      });
      const result = await session.client.request<{
        routing?: { skipped?: string; warning?: string; hosts?: string[] };
        services: ServiceView[];
        tls?: TlsView;
        logs?: string[];
      }>("POST", "/api/deploy");
      if (result.logs?.length) {
        for (const line of result.logs) console.log(line);
      }
      printRouting(result.routing);
      printServices(result.services);
      printTls(result.tls);
    } finally {
      session.close();
    }
  });

const remote = program.command("remote").description("Manage deployment remotes");

remote
  .command("add")
  .argument("<name>", "remote name (e.g. production)")
  .argument("<ssh>", "user@host")
  .option("--domain <domain>", "production hostname base")
  .option("--dir <dir>", "remote apps directory")
  .option("--port <port>", "SSH port", (value) => Number(value))
  .action(async (name: string, ssh: string, opts: { domain?: string; dir?: string; port?: number }) => {
    parseSshTarget(ssh, opts.port);
    await addRemote({
      name,
      ssh,
      domain: opts.domain,
      dir: opts.dir,
      port: opts.port,
      log: (msg) => console.log(msg),
    });
  });

remote
  .command("ls")
  .description("List remotes")
  .action(() => {
    const file = loadRemotes();
    const names = Object.keys(file.remotes);
    if (names.length === 0) {
      console.log("No remotes. Run: yarder remote add production user@host");
      return;
    }
    for (const [name, record] of Object.entries(file.remotes)) {
      const domain = record.domain ? ` ${record.domain}` : "";
      console.log(`${name.padEnd(16)} ${record.ssh}${domain}  ${record.dir}`);
    }
  });

remote
  .command("rm")
  .argument("<name>", "remote name")
  .action((name: string) => {
    if (!removeRemote(name)) {
      console.error(`Unknown remote "${name}"`);
      process.exitCode = 1;
      return;
    }
    console.log(`Removed remote ${name}`);
  });

program
  .command("db")
  .description("Database commands")
  .command("shell")
  .description("Open psql against the managed Postgres service")
  .option(envOption.flags, envOption.description, envOption.default)
  .action(async (opts: { env?: string }) => {
    const session = await requireAgent(opts.env);
    try {
      const data = await session.client.request<{ databaseUrl: string; port: number; database: string }>("GET", "/api/db");
      const child = openDbShell({
        kind: "postgres",
        name: "postgres",
        port: data.port,
        database: data.database,
        dataDir: "",
        databaseUrl: data.databaseUrl,
      });
      await new Promise<void>((resolve, reject) => {
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`psql exited ${code}`));
        });
      });
    } finally {
      session.close();
    }
  });

async function requireAgent(envName = "local"): Promise<{ client: AgentClient; close: () => void }> {
  const session = await connectEnv(envName);
  if (session.name === "local" && !(await session.client.health())) {
    throw new Error(`yarder agent is not running on ${agentBaseUrl()}. Start it with: yarder dev`);
  }
  return session;
}

function printServices(services: ServiceView[]): void {
  for (const service of services) {
    const loc = service.hostname ? `${service.hostname}` : service.url ?? "";
    const mem = service.memory ? ` ${(service.memory / 1024 / 1024).toFixed(0)}MB` : "";
    const health = service.health ? ` ${service.health}` : "";
    console.log(`${service.name.padEnd(12)} ${service.status.padEnd(10)} ${service.kind.padEnd(10)}${health.padEnd(11)} ${loc}${mem}`);
  }
}

function printEnv(services: Record<string, Record<string, EnvVarView>>): void {
  for (const [name, vars] of Object.entries(services)) {
    console.log(name);
    const keys = Object.keys(vars).sort();
    if (keys.length === 0) {
      console.log("  (none)");
      continue;
    }
    for (const key of keys) {
      const entry = vars[key];
      console.log(`  ${key}=${entry.value}  (${entry.source})`);
    }
  }
}

function printRouting(routing?: { skipped?: string; warning?: string; hosts?: string[] }): void {
  if (!routing) return;
  if (routing.skipped) {
    console.warn(routing.skipped);
  }
  if (routing.warning) {
    console.warn(routing.warning);
  }
  if (routing.hosts?.length) {
    console.log(`Hostnames: ${routing.hosts.join(", ")}`);
  }
}

function printTls(tls?: TlsView): void {
  if (!tls || tls.status === "none") return;
  if (tls.status === "active") {
    console.log(`TLS: active${tls.expiry ? ` (expires ${tls.expiry})` : ""}`);
    return;
  }
  if (tls.message) {
    console.warn(`TLS: ${tls.status} | ${tls.message}`);
  }
}

function printLog(entry: { ts: string; service: string; stream: string; line: string }): void {
  const time = entry.ts.slice(11, 19);
  console.log(`${time} [${entry.service}] ${entry.line}`);
}

function openLogStream(
  client: AgentClient,
  service: string | undefined,
  stopStackOnExit: boolean,
): { ready: Promise<void>; done: Promise<void>; close: () => void; shutdown: () => Promise<void> } {
  const ws = client.wsLogs();
  let closed = false;
  let shuttingDown = false;

  const close = () => {
    if (closed) return;
    closed = true;
    ws.close();
  };

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (stopStackOnExit) {
      process.stderr.write("\nStopping stack...\n");
      try {
        await client.request("POST", "/api/dev/stop");
      } catch {
        try {
          const removed = await deleteAllyarderProcesses();
          if (removed.length > 0) {
            process.stderr.write(`Removed PM2 processes: ${removed.join(", ")}\n`);
          }
        } catch {
          // PM2 may not be reachable.
        }
      }
    }
    close();
  };

  const ready = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Log stream closed")), { once: true });
  });

  const done = new Promise<void>((resolve) => {
    const onSignal = () => {
      void shutdown().finally(() => resolve());
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    if (process.platform === "win32") {
      process.once("SIGBREAK", onSignal);
    }
    ws.addEventListener("message", (event) => {
      const entry = JSON.parse(String(event.data)) as {
        ts: string;
        service: string;
        stream: string;
        line: string;
      };
      if (service && entry.service !== service) return;
      printLog(entry);
    });
    ws.addEventListener("close", () => resolve());
  });

  return { ready, done, close, shutdown };
}

await program.parseAsync(process.argv);
