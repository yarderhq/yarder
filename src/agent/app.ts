import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import middie from "@fastify/middie";
import fastifyStatic from "@fastify/static";
import { createServer as createViteServer } from "vite";
import { AGENT_HOST, agentBaseUrl, yarderEnv } from "../config/constants.ts";
import { findConfigFile, loadConfig, projectRootFromConfig } from "../config/load.ts";
import { describeProjectEnv, resolveProject, type UrlScheme } from "../config/resolve.ts";
import { registerAuth } from "./auth.ts";
import { tlsStatusFor } from "./certbot.ts";
import { deployStack } from "./deploy.ts";
import { startFailurePayload } from "./health.ts";
import { recentLogs, startLogBus, subscribeLogs } from "./logs.ts";
import {
  projectStatus,
  restartService,
  restartStack,
  startOne,
  startStack,
  stopOne,
  stopStack,
} from "./lifecycle.ts";
import { saveAgentState } from "./persist.ts";
import { ensurePm2 } from "./pm2.ts";
import { platformSummary } from "./platform.ts";
import { findPostgresBins, postgresMissingHint } from "./postgres.ts";
import { findRedisBins, redisMissingHint } from "./redis.ts";
import { getProject, getProjectOrNull, setProject } from "./state.ts";
import { loadRemotes, getRemote } from "../remote/remotes.ts";
import { closeTunnel, ensureTunnel } from "../remote/tunnel.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function asUrlScheme(value: unknown): UrlScheme | undefined {
  return value === "https" || value === "http" ? value : undefined;
}

export async function buildAgent() {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);
  registerAuth(app);

  app.get("/api/health", async () => ({
    ok: true,
    name: "yarder-agent",
    env: yarderEnv(),
    platform: platformSummary(),
  }));

  app.get("/api/platform", async () => ({
    ...platformSummary(),
    env: yarderEnv(),
    postgres: findPostgresBins() ? "available" : postgresMissingHint(),
    redis: findRedisBins() ? "available" : redisMissingHint(),
  }));

  app.get("/api/environments", async () => {
    const remotes = loadRemotes();
    return {
      current: yarderEnv(),
      environments: [
        {
          name: "local",
          kind: "local",
          url: agentBaseUrl(),
          reachable: true,
        },
        ...Object.entries(remotes.remotes).map(([name, remote]) => ({
          name,
          kind: "remote" as const,
          url: `http://127.0.0.1:${remote.localTunnelPort}`,
          token: remote.token,
          domain: remote.domain,
          reachable: false,
        })),
      ],
    };
  });

  app.post<{ Params: { name: string } }>("/api/environments/:name/up", async (req, reply) => {
    const name = req.params.name;
    if (name === "local") {
      return { ok: true, name, url: agentBaseUrl() };
    }
    try {
      const tunnel = await ensureTunnel(name);
      const remote = getRemote(name);
      return { ok: true, name, url: tunnel.url, token: remote?.token, domain: remote?.domain };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { name: string } }>("/api/environments/:name/down", async (req) => {
    if (req.params.name !== "local") closeTunnel(req.params.name);
    return { ok: true };
  });

  app.post<{ Body: { root?: string; hostnameBase?: string; urlScheme?: string } }>("/api/project/load", async (req, reply) => {
    const start = req.body?.root ? path.resolve(req.body.root) : process.cwd();
    const configPath = findConfigFile(start);
    if (!configPath) {
      return reply.code(404).send({ error: `No yarder.yaml found from ${start}` });
    }
    const config = loadConfig(configPath);
    const root = projectRootFromConfig(configPath);
    const hostnameBase = req.body?.hostnameBase?.trim() || undefined;
    const urlScheme = asUrlScheme(req.body?.urlScheme);
    const resolved = resolveProject(config, root, { hostnameBase, urlScheme });
    const project = setProject({ root, configPath, config, resolved });
    saveAgentState({
      root: project.root,
      hostnameBase: project.resolved.hostnameBase || undefined,
      urlScheme: project.resolved.urlScheme,
      envName: project.resolved.envName,
    });
    return {
      name: project.config.name,
      root: project.root,
      hostnameBase: project.resolved.hostnameBase,
      env: project.resolved.envName,
      services: Object.keys(project.resolved.services),
    };
  });

  app.get("/api/project", async (req, reply) => {
    const project = getProjectOrNull();
    if (!project) {
      return reply.code(404).send({ error: "No project loaded" });
    }
    return {
      name: project.config.name,
      root: project.root,
      hostnameBase: project.resolved.hostnameBase,
      env: project.resolved.envName,
      tls: tlsStatusFor(project.resolved),
      services: await projectStatus(project.resolved),
      platform: platformSummary(),
    };
  });

  app.post("/api/dev/start", async (req, reply) => {
    try {
      const project = getProject();
      await ensurePm2();
      await startLogBus();
      const { routing } = await startStack(project.resolved);
      return {
        ok: true,
        routing,
        services: await projectStatus(project.resolved),
      };
    } catch (err) {
      return reply.code(500).send(startFailurePayload(err));
    }
  });

  app.post("/api/deploy", async (req, reply) => {
    try {
      const project = getProject();
      await ensurePm2();
      await startLogBus();
      const result = await deployStack(project.resolved);
      if (result.tls.status === "active" && project.resolved.urlScheme !== "https") {
        const resolved = resolveProject(project.config, project.root, {
          hostnameBase: project.resolved.hostnameBase,
          urlScheme: "https",
          envName: project.resolved.envName,
        });
        setProject({ ...project, resolved });
        saveAgentState({
          root: project.root,
          hostnameBase: resolved.hostnameBase || undefined,
          urlScheme: "https",
          envName: resolved.envName,
        });
        return {
          ok: true,
          routing: result.routing,
          tls: result.tls,
          logs: result.buildLog,
          services: await projectStatus(resolved),
        };
      }
      return {
        ok: true,
        routing: result.routing,
        tls: result.tls,
        logs: result.buildLog,
        services: await projectStatus(project.resolved),
      };
    } catch (err) {
      return reply.code(500).send(startFailurePayload(err));
    }
  });

  app.post("/api/dev/stop", async () => {
    const project = getProject();
    await stopStack(project.resolved);
    return { ok: true, services: await projectStatus(project.resolved) };
  });

  app.post("/api/dev/restart", async (req, reply) => {
    try {
      const project = getProject();
      await ensurePm2();
      await startLogBus();
      const { routing } = await restartStack(project.resolved);
      return {
        ok: true,
        routing,
        services: await projectStatus(project.resolved),
      };
    } catch (err) {
      return reply.code(500).send(startFailurePayload(err));
    }
  });

  app.post<{ Params: { name: string } }>("/api/services/:name/start", async (req, reply) => {
    try {
      const project = getProject();
      await startOne(project.resolved, req.params.name);
      return { ok: true, services: await projectStatus(project.resolved) };
    } catch (err) {
      return reply.code(500).send(startFailurePayload(err));
    }
  });

  app.post<{ Params: { name: string } }>("/api/services/:name/stop", async (req, reply) => {
    try {
      const project = getProject();
      await stopOne(project.resolved, req.params.name);
      return { ok: true, services: await projectStatus(project.resolved) };
    } catch (err) {
      return reply.code(500).send(startFailurePayload(err));
    }
  });

  app.post<{ Params: { name: string } }>("/api/services/:name/restart", async (req, reply) => {
    try {
      const project = getProject();
      await restartService(project.resolved, req.params.name);
      return { ok: true, services: await projectStatus(project.resolved) };
    } catch (err) {
      return reply.code(500).send(startFailurePayload(err));
    }
  });

  app.get("/api/status", async (req, reply) => {
    const project = getProjectOrNull();
    if (!project) return reply.code(404).send({ error: "No project loaded" });
    return { services: await projectStatus(project.resolved), tls: tlsStatusFor(project.resolved), env: project.resolved.envName };
  });

  app.get<{ Querystring: { service?: string; limit?: string } }>("/api/logs", async (req) => {
    return { logs: recentLogs(req.query.service, Number(req.query.limit ?? 200)) };
  });

  app.get("/api/env", async (req, reply) => {
    const project = getProjectOrNull();
    if (!project) return reply.code(404).send({ error: "No project loaded" });
    return { services: describeProjectEnv(project.resolved) };
  });

  app.get("/api/tls", async (req, reply) => {
    const project = getProjectOrNull();
    if (!project) return reply.code(404).send({ error: "No project loaded" });
    return tlsStatusFor(project.resolved);
  });

  app.get("/api/db", async (req, reply) => {
    const project = getProjectOrNull();
    if (!project) return reply.code(404).send({ error: "No project loaded" });
    const postgres = Object.values(project.resolved.services).find((service) => service.kind === "postgres");
    if (!postgres || postgres.kind !== "postgres") {
      return reply.code(404).send({ error: "No postgres service in yarder.yaml" });
    }
    return {
      databaseUrl: postgres.databaseUrl,
      port: postgres.port,
      database: postgres.database,
    };
  });

  app.get("/ws/logs", { websocket: true }, (socket) => {
    const send = (entry: unknown) => {
      socket.send(JSON.stringify(entry));
    };
    for (const entry of recentLogs(undefined, 100)) {
      send(entry);
    }
    const unsubscribe = subscribeLogs(send);
    socket.on("close", unsubscribe);
  });

  const distPath = path.join(rootDir, "dist/gui");
  if (fs.existsSync(path.join(distPath, "index.html"))) {
    await app.register(fastifyStatic, { root: distPath });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    const vite = await createViteServer({
      configFile: path.join(rootDir, "vite.config.ts"),
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    await app.register(middie);
    app.use((req, res, next) => {
      const url = req.url ?? "";
      if (url.startsWith("/api") || url.startsWith("/ws")) {
        next();
        return;
      }
      vite.middlewares(req, res, next);
    });
  }

  return app;
}

export async function listenAgent(port: number) {
  const app = await buildAgent();
  await app.listen({ port, host: AGENT_HOST });
  return app;
}
