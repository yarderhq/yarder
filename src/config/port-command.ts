import fs from "node:fs";
import path from "node:path";

export type ListenKind = "next" | "nuxt" | "vite" | "astro";

export type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type PackageManagerCommand = {
  agent: string;
  script: string;
  extra: string;
};

const PORT_FLAG_RE = /\s+(?:--port=\d+|--port\s+\d+|-p\s+\d+)/g;

export function stripPortFlags(command: string): string {
  return command.replace(PORT_FLAG_RE, "").replace(/\s+/g, " ").trim();
}

export function parsePackageManagerCommand(command: string): PackageManagerCommand | null {
  const trimmed = command.trim();
  const headed = trimmed.match(/^(npm|npx|pnpm|yarn|bunx|bun)(?:\.cmd)?\s+([\s\S]+)$/i);
  if (!headed) return null;
  const agent = headed[1].toLowerCase();
  const rest = headed[2].trim();
  const runMatch = rest.match(/(?:^|\s)run\s+(\S+)(?:\s+--\s+([\s\S]+))?$/);
  if (runMatch) {
    return { agent, script: runMatch[1], extra: (runMatch[2] ?? "").trim() };
  }
  const simple = rest.match(/^(run\s+)?(\S+)(?:\s+--\s+([\s\S]+))?$/);
  if (!simple) return null;
  const script = simple[2];
  if (script.startsWith("-")) return null;
  return { agent, script, extra: (simple[3] ?? "").trim() };
}

export function detectListenKind(command: string): ListenKind | null {
  if (/\bnuxt\b/.test(command) || /\bnuxi\b/.test(command)) return "nuxt";
  if (/\bnext\b/.test(command)) return "next";
  if (/\bastro\b/.test(command)) return "astro";
  if (/\bvite\b/.test(command)) return "vite";
  return null;
}

export function kindFromDependencies(pkg?: PackageJson | null): ListenKind | null {
  if (!pkg) return null;
  const names = { ...pkg.dependencies, ...pkg.devDependencies };
  if (names.next) return "next";
  if (names.nuxt || names.nuxi) return "nuxt";
  if (names.astro) return "astro";
  if (names.vite) return "vite";
  return null;
}

export function portArgs(kind: ListenKind, port: number): string {
  if (kind === "next") return `-p ${port}`;
  return `--port ${port}`;
}

export function expandPackageScript(command: string, pkg?: PackageJson | null): string | null {
  const parsed = parsePackageManagerCommand(command);
  if (!parsed) return null;
  const body = pkg?.scripts?.[parsed.script];
  if (!body) return null;
  return parsed.extra ? `${body} ${parsed.extra}` : body;
}

export function readPackageJson(dir: string): PackageJson | null {
  const file = path.join(dir, "package.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

export function commandWithPort(
  command: string,
  port: number | undefined,
  options: { dir?: string; pkg?: PackageJson | null } = {},
): string {
  if (!port) return command;
  const pkg = options.pkg !== undefined ? options.pkg : options.dir ? readPackageJson(options.dir) : null;
  const expanded = expandPackageScript(command, pkg);
  const kindFromCommand = detectListenKind(expanded ?? command);
  if (kindFromCommand) {
    return `${stripPortFlags(expanded ?? command)} ${portArgs(kindFromCommand, port)}`.trim();
  }
  if (expanded) return command;

  const kind = kindFromDependencies(pkg);
  if (!kind) return command;
  const overlay = portArgs(kind, port);
  const parsed = parsePackageManagerCommand(command);
  if (parsed) {
    const base = stripPortFlags(command);
    return base.includes(" -- ") ? `${base} ${overlay}` : `${base} -- ${overlay}`;
  }
  return `${stripPortFlags(command)} ${overlay}`.trim();
}

export function nodeBinPathPrefix(dir: string): string {
  const bins: string[] = [];
  let current = path.resolve(dir);
  for (;;) {
    const bin = path.join(current, "node_modules", ".bin");
    if (fs.existsSync(bin)) bins.push(bin);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return bins.join(path.delimiter);
}
