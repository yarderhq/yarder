import path from "node:path";
import { envKey, RUNTIME_DIRNAME, slugify, yarderEnv, type yarderEnvName } from "./constants.ts";
import { loadDotenv, mergeServiceEnv, redactEnv, type EnvSource, type EnvVarView } from "./env.ts";
import { commandWithPort } from "./port-command.ts";
import {
  isPostgresService,
  isRedisService,
  type AppService,
  type PostgresService,
  type RedisService,
  type Service,
  type yarderConfig,
} from "./schema.ts";

export type UrlScheme = "http" | "https";

export type ResolveOptions = {
  hostnameBase?: string;
  urlScheme?: UrlScheme;
  envName?: yarderEnvName;
};

export type ResolvedAppService = {
  kind: "process";
  name: string;
  command: string;
  dir: string;
  port?: number;
  health?: string;
  hostname?: string;
  url?: string;
  env: Record<string, string>;
  envSources: Record<string, EnvSource>;
  dependsOn: string[];
  install?: string;
  build?: string;
  dev?: string;
};

export type ResolvedPostgresService = {
  kind: "postgres";
  name: string;
  port: number;
  database: string;
  dataDir: string;
  databaseUrl: string;
};

export type ResolvedRedisService = {
  kind: "redis";
  name: string;
  port: number;
  dataDir: string;
  pidFile: string;
  redisUrl: string;
};

export type ResolvedService = ResolvedAppService | ResolvedPostgresService | ResolvedRedisService;

export type ResolvedProject = {
  name: string;
  hostnameBase: string;
  urlScheme: UrlScheme;
  envName: yarderEnvName;
  root: string;
  runtimeDir: string;
  services: Record<string, ResolvedService>;
};

export function localHostnameBase(config: yarderConfig): string {
  if (config.hostname?.endsWith(".test")) return config.hostname;
  return `${slugify(config.name)}.test`;
}

export function productionHostnameBase(config: yarderConfig, override?: string): string {
  if (override?.trim()) return override.trim();
  if (config.hostname && !config.hostname.endsWith(".test")) return config.hostname;
  return "";
}

export function resolveProject(config: yarderConfig, root: string, opts: ResolveOptions = {}): ResolvedProject {
  const envName = opts.envName ?? yarderEnv();
  const hostnameBase =
    opts.hostnameBase?.trim() ||
    (envName === "production" ? productionHostnameBase(config) : localHostnameBase(config));
  const urlScheme = opts.urlScheme ?? "http";
  const runtimeDir = path.join(root, RUNTIME_DIRNAME);
  const dotenv = loadDotenv(root);
  const services: Record<string, ResolvedService> = {};

  for (const [name, service] of Object.entries(config.services)) {
    services[name] = resolveService(name, service, { root, hostnameBase, runtimeDir, config, envName, urlScheme });
  }

  const injected: Record<string, string> = {};
  for (const [name, service] of Object.entries(services)) {
    if (service.kind === "process" && service.url) {
      injected[envKey(name, "URL")] = service.url;
    }
    if (service.kind === "postgres") {
      injected.DATABASE_URL = service.databaseUrl;
      injected[envKey(name, "URL")] = service.databaseUrl;
    }
    if (service.kind === "redis") {
      injected.REDIS_URL = service.redisUrl;
      injected[envKey(name, "URL")] = service.redisUrl;
    }
  }

  for (const service of Object.values(services)) {
    if (service.kind !== "process") continue;
    const yaml = { ...service.env };
    const serviceInjected = { ...injected };
    if (service.port) {
      serviceInjected.PORT = String(service.port);
    }
    const merged = mergeServiceEnv({ dotenv, yaml, injected: serviceInjected });
    service.env = merged.env;
    service.envSources = merged.sources;
  }

  return {
    name: config.name,
    hostnameBase,
    urlScheme,
    envName,
    root,
    runtimeDir,
    services,
  };
}

export function startOrder(project: ResolvedProject): string[] {
  const names = Object.keys(project.services);
  const remaining = new Set(names);
  const ordered: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) => {
      const service = project.services[name];
      const deps = service.kind === "process" ? service.dependsOn : [];
      return deps.every((dep) => !remaining.has(dep));
    });
    if (ready.length === 0) {
      throw new Error("Cycle or missing dependency in service depends_on");
    }
    ready.sort();
    for (const name of ready) {
      remaining.delete(name);
      ordered.push(name);
    }
  }

  return ordered;
}

export function describeServiceEnv(service: ResolvedService): Record<string, EnvVarView> {
  if (service.kind === "process") {
    return redactEnv(service.env, service.envSources);
  }
  if (service.kind === "postgres") {
    return {
      DATABASE_URL: { value: service.databaseUrl, source: "injected" },
    };
  }
  return {
    REDIS_URL: { value: service.redisUrl, source: "injected" },
  };
}

export function describeProjectEnv(project: ResolvedProject): Record<string, Record<string, EnvVarView>> {
  const services: Record<string, Record<string, EnvVarView>> = {};
  for (const [name, service] of Object.entries(project.services)) {
    services[name] = describeServiceEnv(service);
  }
  return services;
}

function resolveService(
  name: string,
  service: Service,
  ctx: {
    root: string;
    hostnameBase: string;
    runtimeDir: string;
    config: yarderConfig;
    envName: yarderEnvName;
    urlScheme: UrlScheme;
  },
): ResolvedService {
  if (isPostgresService(service)) {
    return resolvePostgres(name, service, ctx);
  }
  if (isRedisService(service)) {
    return resolveRedis(name, service, ctx);
  }
  return resolveApp(name, service, ctx);
}

function resolveApp(
  name: string,
  service: AppService,
  ctx: { root: string; hostnameBase: string; envName: yarderEnvName; urlScheme: UrlScheme },
): ResolvedAppService {
  const dir = path.resolve(ctx.root, service.dir);
  const rawCommand = ctx.envName === "local" && service.dev ? service.dev : service.command;
  const hostname = service.port && ctx.hostnameBase ? `${slugify(name)}.${ctx.hostnameBase}` : undefined;
  const url = hostname
    ? `${ctx.urlScheme}://${hostname}`
    : service.port
      ? `http://127.0.0.1:${service.port}`
      : undefined;
  return {
    kind: "process",
    name,
    command: commandWithPort(rawCommand, service.port, { dir }),
    dir,
    port: service.port,
    health: service.health,
    hostname,
    url,
    env: { ...(service.env ?? {}) },
    envSources: {},
    dependsOn: service.depends_on ?? [],
    install: service.install,
    build: service.build,
    dev: service.dev,
  };
}

function resolvePostgres(
  name: string,
  service: PostgresService,
  ctx: { runtimeDir: string; config: yarderConfig },
): ResolvedPostgresService {
  const port = service.port ?? 55432;
  const database = service.database ?? slugify(ctx.config.name).replace(/-/g, "_");
  return {
    kind: "postgres",
    name,
    port,
    database,
    dataDir: path.join(ctx.runtimeDir, "data", name),
    databaseUrl: `postgres://yarder@127.0.0.1:${port}/${database}`,
  };
}

function resolveRedis(
  name: string,
  service: RedisService,
  ctx: { runtimeDir: string },
): ResolvedRedisService {
  const port = service.port ?? 56379;
  const dataDir = path.join(ctx.runtimeDir, "data", name);
  return {
    kind: "redis",
    name,
    port,
    dataDir,
    pidFile: path.join(dataDir, "redis.pid"),
    redisUrl: `redis://127.0.0.1:${port}`,
  };
}
