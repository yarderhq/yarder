import { isNativeWindows, isWsl } from "../agent/platform.ts";
import { findPostgresBins } from "../agent/postgres.ts";
import { findRedisBins } from "../agent/redis.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodeMeetsEngine } from "./node-version.ts";
import { defaultRun, defaultWhich } from "./run.ts";
import type { SetupCheck, SetupContext } from "./types.ts";
import {
  pickDistro,
  probeWsl,
  wslHasBin,
  wslNodeVersion,
  type WslDistro,
} from "./windows.ts";

export function defaultContext(): SetupContext {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  return {
    platform: process.platform,
    isWsl: isWsl(),
    isNativeWindows: isNativeWindows(),
    nodeVersion: process.version,
    env: process.env,
    run: defaultRun,
    which: defaultWhich,
    hasPostgres: () => findPostgresBins() !== null,
    hasRedis: () => findRedisBins() !== null,
    hasDebian: process.platform === "linux" && (fs.existsSync("/etc/debian_version") || defaultWhich("apt-get") !== null),
    hasHomebrew: process.platform === "darwin" && defaultWhich("brew") !== null,
    packageRoot: root,
    cwd: process.cwd(),
    log: (msg) => console.log(msg),
  };
}

function ok(id: SetupCheck["id"], label: string, detail: string): SetupCheck {
  return { id, label, status: "ok", detail };
}

function missing(
  id: SetupCheck["id"],
  label: string,
  detail: string,
  repair?: SetupCheck["repair"],
): SetupCheck {
  return { id, label, status: "missing", detail, repair };
}

function action(
  id: SetupCheck["id"],
  label: string,
  detail: string,
  repair?: SetupCheck["repair"],
): SetupCheck {
  return { id, label, status: "action", detail, repair };
}

function pendingWsl(id: SetupCheck["id"], label: string): SetupCheck {
  return missing(id, label, "Requires WSL2 / Ubuntu");
}

function wslPostgres(ctx: SetupContext, distro: string): boolean {
  return (
    wslHasBin(ctx, distro, "initdb") &&
    wslHasBin(ctx, distro, "pg_ctl") &&
    wslHasBin(ctx, distro, "psql") &&
    wslHasBin(ctx, distro, "createdb")
  );
}

function wslRedis(ctx: SetupContext, distro: string): boolean {
  return wslHasBin(ctx, distro, "redis-server") && wslHasBin(ctx, distro, "redis-cli");
}

function unixNode(ctx: SetupContext): SetupCheck {
  const label = "Node 22";
  if (nodeMeetsEngine(ctx.nodeVersion)) {
    return ok("node", label, ctx.nodeVersion);
  }
  if (ctx.env.NVM_DIR) {
    return action("node", label, `${ctx.nodeVersion} | nvm detected, run: nvm install 22`, "install-node-nvm");
  }
  if (ctx.platform === "darwin") {
    return missing("node", label, `${ctx.nodeVersion} | install Node 22 from https://nodejs.org`);
  }
  if (ctx.hasDebian) {
    return missing("node", label, `${ctx.nodeVersion} | will install Node 22 via NodeSource`, "install-node-apt");
  }
  return missing("node", label, `${ctx.nodeVersion} | install Node 22, then re-run yarder setup --check`);
}

function unixNginx(ctx: SetupContext): SetupCheck {
  const label = "nginx";
  if (ctx.which("nginx")) return ok("nginx", label, ctx.which("nginx") ?? "found");
  return missing("nginx", label, "nginx not found on PATH", unixRepair(ctx));
}

function unixPostgres(ctx: SetupContext): SetupCheck {
  const label = "postgres";
  if (ctx.hasPostgres()) return ok("postgres", label, "initdb/pg_ctl/psql/createdb found");
  return missing("postgres", label, "PostgreSQL binaries not found", unixRepair(ctx));
}

function unixRedis(ctx: SetupContext): SetupCheck {
  const label = "redis";
  if (ctx.hasRedis()) return ok("redis", label, "redis-server/redis-cli found");
  return missing("redis", label, "Redis binaries not found", unixRepair(ctx));
}

function unixRepair(ctx: SetupContext): SetupCheck["repair"] | undefined {
  if (ctx.platform === "darwin") return ctx.hasHomebrew ? "brew-packages" : undefined;
  if (ctx.platform === "linux") return ctx.hasDebian ? "apt-packages" : undefined;
  return undefined;
}

function probeWindowsDistro(ctx: SetupContext, distro: WslDistro): SetupCheck[] {
  const name = distro.name;
  const nodeVersion = wslNodeVersion(ctx, name);
  const node = nodeVersion && nodeMeetsEngine(nodeVersion)
    ? ok("node", "Node 22", `${nodeVersion} in ${name}`)
    : missing(
        "node",
        "Node 22",
        nodeVersion ? `${nodeVersion} in ${name}` : `Node 22 not found in ${name}`,
        "provision-wsl",
      );
  const nginx = wslHasBin(ctx, name, "nginx")
    ? ok("nginx", "nginx", `found in ${name}`)
    : missing("nginx", "nginx", `not found in ${name}`, "provision-wsl");
  const postgres = wslPostgres(ctx, name)
    ? ok("postgres", "postgres", `found in ${name}`)
    : missing("postgres", "postgres", `not found in ${name}`, "provision-wsl");
  const redis = wslRedis(ctx, name)
    ? ok("redis", "redis", `found in ${name}`)
    : missing("redis", "redis", `not found in ${name}`, "provision-wsl");
  return [node, nginx, postgres, redis];
}

export function probeSetup(ctx: SetupContext): SetupCheck[] {
  if (ctx.isNativeWindows) {
    const wsl = probeWsl(ctx);
    const selected = wsl.selected ?? pickDistro(wsl.distros);
    if (!wsl.installed) {
      return [
        missing("wsl", "WSL2 / Ubuntu", wsl.error ?? "WSL is not installed.", "install-wsl"),
        pendingWsl("node", "Node 22"),
        pendingWsl("nginx", "nginx"),
        pendingWsl("postgres", "postgres"),
        pendingWsl("redis", "redis"),
      ];
    }
    if (wsl.distros.length === 0) {
      return [
        missing("wsl", "WSL2 / Ubuntu", "No WSL distro installed.", "install-ubuntu"),
        pendingWsl("node", "Node 22"),
        pendingWsl("nginx", "nginx"),
        pendingWsl("postgres", "postgres"),
        pendingWsl("redis", "redis"),
      ];
    }
    if (!selected) {
      const names = wsl.distros.map((distro) => `${distro.name} (v${distro.version})`).join(", ");
      return [
        action(
          "wsl",
          "WSL2 / Ubuntu",
          `Found ${names}, but none are WSL2. Will set WSL version 2.`,
          "set-wsl-version",
        ),
        pendingWsl("node", "Node 22"),
        pendingWsl("nginx", "nginx"),
        pendingWsl("postgres", "postgres"),
        pendingWsl("redis", "redis"),
      ];
    }
    return [
      ok("wsl", "WSL2 / Ubuntu", `${selected.name} v${selected.version} (${selected.state})`),
      ...probeWindowsDistro(ctx, selected),
    ];
  }

  const checks = [unixNode(ctx), unixNginx(ctx), unixPostgres(ctx), unixRedis(ctx)];
  if (ctx.platform === "darwin" && !ctx.hasHomebrew && checks.some((check) => check.status !== "ok" && check.id !== "node")) {
    for (const check of checks) {
      if (check.id !== "node" && check.status !== "ok") {
        check.detail = `${check.detail}. Install Homebrew from https://brew.sh then run yarder setup again.`;
      }
    }
  }
  if (ctx.platform === "linux" && !ctx.hasDebian && checks.some((check) => check.status !== "ok" && check.id !== "node")) {
    for (const check of checks) {
      if (check.id !== "node" && check.status !== "ok") {
        check.detail = `${check.detail}. Install nginx, postgresql, and redis-server for this distro, then re-run yarder setup --check.`;
      }
    }
  }
  return checks;
}

export function isReady(checks: SetupCheck[]): boolean {
  return checks.every((check) => check.status === "ok");
}
