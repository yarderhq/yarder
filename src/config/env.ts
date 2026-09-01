import fs from "node:fs";
import path from "node:path";

export type EnvSource = "dotenv" | "yaml" | "injected";

export type EnvVarView = {
  value: string;
  source: EnvSource;
};

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of contents.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    result[key] = unquote(line.slice(eq + 1).trim());
  }
  return result;
}

export function loadDotenv(root: string): Record<string, string> {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return {};
  return parseEnvFile(fs.readFileSync(file, "utf8"));
}

export function mergeServiceEnv(input: {
  dotenv: Record<string, string>;
  yaml: Record<string, string>;
  injected: Record<string, string>;
}): { env: Record<string, string>; sources: Record<string, EnvSource> } {
  const env = { ...input.dotenv, ...input.yaml, ...input.injected };
  const sources: Record<string, EnvSource> = {};
  for (const key of Object.keys(env)) {
    if (Object.prototype.hasOwnProperty.call(input.injected, key)) {
      sources[key] = "injected";
    } else if (Object.prototype.hasOwnProperty.call(input.yaml, key)) {
      sources[key] = "yaml";
    } else {
      sources[key] = "dotenv";
    }
  }
  return { env, sources };
}

export function redactEnv(
  env: Record<string, string>,
  sources: Record<string, EnvSource>,
): Record<string, EnvVarView> {
  const view: Record<string, EnvVarView> = {};
  for (const [key, source] of Object.entries(sources)) {
    const value = env[key];
    if (value === undefined) continue;
    view[key] = {
      source,
      value: source === "injected" ? value : "***",
    };
  }
  return view;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const start = value[0];
    const end = value[value.length - 1];
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
