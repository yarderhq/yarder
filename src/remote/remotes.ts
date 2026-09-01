import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { yarderHome } from "../config/constants.ts";

export type RemoteRecord = {
  ssh: string;
  port?: number;
  dir: string;
  token: string;
  domain?: string;
  agentPort: number;
  localTunnelPort: number;
};

export type RemotesFile = {
  remotes: Record<string, RemoteRecord>;
};

export function remotesPath(): string {
  return process.env.YARDER_REMOTES_PATH ?? path.join(yarderHome(), "remotes.yaml");
}

export function loadRemotes(): RemotesFile {
  const file = remotesPath();
  if (!fs.existsSync(file)) return { remotes: {} };
  const parsed = parseYaml(fs.readFileSync(file, "utf8")) as RemotesFile | undefined;
  if (!parsed || typeof parsed !== "object") return { remotes: {} };
  return { remotes: parsed.remotes ?? {} };
}

export function saveRemotes(file: RemotesFile): void {
  const dest = remotesPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, stringifyYaml(file, { lineWidth: 0 }));
}

export function getRemote(name: string): RemoteRecord | undefined {
  return loadRemotes().remotes[name];
}

export function upsertRemote(name: string, remote: RemoteRecord): void {
  const file = loadRemotes();
  file.remotes[name] = remote;
  saveRemotes(file);
}

export function removeRemote(name: string): boolean {
  const file = loadRemotes();
  if (!file.remotes[name]) return false;
  delete file.remotes[name];
  saveRemotes(file);
  return true;
}

export function defaultRemoteName(): string | undefined {
  const names = Object.keys(loadRemotes().remotes);
  if (names.includes("production")) return "production";
  return names[0];
}

export function remoteAppDir(remote: RemoteRecord, projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "app";
  return `${remote.dir.replace(/\/$/, "")}/${slug}`;
}
