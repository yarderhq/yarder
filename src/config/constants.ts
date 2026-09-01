import os from "node:os";
import path from "node:path";

export const AGENT_HOST = process.env.YARDER_AGENT_HOST ?? "127.0.0.1";
export const AGENT_PORT = Number(process.env.YARDER_AGENT_PORT ?? 3847);
export const CONFIG_FILENAME = "yarder.yaml";
export const RUNTIME_DIRNAME = ".yarder";
export const PM2_PREFIX = "yarder";
export const HEALTH_TIMEOUT_MS = 30_000;
export const HEALTH_POLL_MS = 200;
export const ACME_WEBROOT = "/var/lib/yarder/acme";

export type yarderEnvName = "local" | "production";

export function yarderEnv(): yarderEnvName {
  return process.env.YARDER_ENV === "production" ? "production" : "local";
}

export function isProduction(): boolean {
  return yarderEnv() === "production";
}

export function agentBaseUrl(port = AGENT_PORT, host = AGENT_HOST): string {
  return `http://${host}:${port}`;
}

export function yarderHome(): string {
  return process.env.YARDER_HOME ?? path.join(os.homedir(), ".yarder");
}

export function agentToken(): string | undefined {
  const fromEnv = process.env.YARDER_AGENT_TOKEN?.trim();
  return fromEnv || undefined;
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "app";
}

export function envKey(serviceName: string, suffix: string): string {
  return `${serviceName.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_${suffix}`;
}
