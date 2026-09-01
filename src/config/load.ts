import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { CONFIG_FILENAME } from "./constants.ts";
import { yarderConfigSchema, type yarderConfig } from "./schema.ts";

export function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function loadConfig(configPath: string): yarderConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = parseYaml(raw);
  return yarderConfigSchema.parse(parsed);
}

export function writeConfig(configPath: string, config: yarderConfig): void {
  fs.writeFileSync(configPath, stringifyYaml(config, { lineWidth: 0 }));
}

export function projectRootFromConfig(configPath: string): string {
  return path.dirname(path.resolve(configPath));
}

export function guessInitConfig(cwd: string): yarderConfig {
  const pkgPath = path.join(cwd, "package.json");
  let name = path.basename(cwd);
  let command = "npm start";

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      if (pkg.name) {
        name = pkg.name.replace(/^@[^/]+\//, "");
      }
      if (pkg.scripts?.dev) {
        command = "npm run dev";
      } else if (pkg.scripts?.start) {
        command = "npm start";
      }
    } catch {
      // Keep conservative defaults.
    }
  }

  return {
    name,
    services: {
      web: {
        command,
        dir: ".",
        port: 3000,
      },
    },
  };
}
