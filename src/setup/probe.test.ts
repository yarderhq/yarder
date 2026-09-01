import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySetup } from "./apply.ts";
import { nodeMeetsEngine } from "./node-version.ts";
import { isReady, probeSetup } from "./probe.ts";
import type { RunResult, Runner, SetupContext } from "./types.ts";
import {
  normalizeWslText,
  parseWslList,
  pickDistro,
  windowsPathToWsl,
} from "./windows.ts";

function result(status: number, stdout = "", stderr = ""): RunResult {
  return { status, stdout, stderr };
}

function context(partial: Partial<SetupContext> & { run?: Runner }): SetupContext {
  return {
    platform: "linux",
    isWsl: false,
    isNativeWindows: false,
    nodeVersion: "v22.14.0",
    env: {},
    run: partial.run ?? (() => result(1, "")),
    which: () => null,
    hasPostgres: () => false,
    hasRedis: () => false,
    hasDebian: true,
    hasHomebrew: false,
    packageRoot: "/tmp/yarder",
    cwd: "/tmp/app",
    log: () => undefined,
    ...partial,
  };
}

describe("nodeMeetsEngine", () => {
  it("accepts 22+", () => {
    assert.equal(nodeMeetsEngine("v22.14.0"), true);
    assert.equal(nodeMeetsEngine("22.0.0"), true);
    assert.equal(nodeMeetsEngine("v23.1.0"), true);
  });

  it("rejects below 22", () => {
    assert.equal(nodeMeetsEngine("v20.19.0"), false);
    assert.equal(nodeMeetsEngine("18.20.0"), false);
    assert.equal(nodeMeetsEngine(""), false);
  });
});

describe("parseWslList", () => {
  it("parses a default Ubuntu WSL2 distro", () => {
    const distros = parseWslList(
      "  NAME              STATE           VERSION\n* Ubuntu            Running         2\n  docker-desktop    Stopped         2\n",
    );
    assert.equal(distros.length, 2);
    assert.equal(distros[0]?.name, "Ubuntu");
    assert.equal(distros[0]?.isDefault, true);
    assert.equal(distros[0]?.version, "2");
    assert.equal(pickDistro(distros)?.name, "Ubuntu");
  });

  it("returns empty when no distros are installed", () => {
    assert.deepEqual(
      parseWslList("Windows Subsystem for Linux has no installed distributions.\nUse wsl.exe --install"),
      [],
    );
  });

  it("strips UTF-16 NULs", () => {
    assert.equal(normalizeWslText("U\u0000b\u0000u\u0000n\u0000t\u0000u"), "Ubuntu");
    const distros = parseWslList("*\u0000 \u0000U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000 \u0000R\u0000u\u0000n\u0000n\u0000i\u0000n\u0000g\u0000 \u0000 \u0000 \u00002");
    assert.equal(pickDistro(distros)?.name, "Ubuntu");
  });
});

describe("windowsPathToWsl", () => {
  it("maps a drive letter path", () => {
    assert.equal(
      windowsPathToWsl("C:\\Users\\twilson\\Documents\\app"),
      "/mnt/c/Users/twilson/Documents/app",
    );
  });
});

describe("probeSetup", () => {
  it("reports all ok on Linux when binaries exist", () => {
    const checks = probeSetup(
      context({
        which: (bin) => (bin === "nginx" ? "/usr/sbin/nginx" : null),
        hasPostgres: () => true,
        hasRedis: () => true,
      }),
    );
    assert.equal(isReady(checks), true);
    assert.deepEqual(
      checks.map((check) => check.id),
      ["node", "nginx", "postgres", "redis"],
    );
  });

  it("marks postgres missing on Linux", () => {
    const checks = probeSetup(
      context({
        which: (bin) => (bin === "nginx" ? "/usr/sbin/nginx" : null),
        hasPostgres: () => false,
        hasRedis: () => true,
      }),
    );
    const postgres = checks.find((check) => check.id === "postgres");
    assert.equal(postgres?.status, "missing");
    assert.equal(postgres?.repair, "apt-packages");
    assert.equal(isReady(checks), false);
  });

  it("asks for WSL install on native Windows when WSL is absent", () => {
    const checks = probeSetup(
      context({
        platform: "win32",
        isNativeWindows: true,
        run: () => result(1, "", "The Windows Subsystem for Linux is not installed. You can install by running: wsl.exe --install"),
      }),
    );
    const wsl = checks.find((check) => check.id === "wsl");
    assert.equal(wsl?.status, "missing");
    assert.equal(wsl?.repair, "install-wsl");
    assert.equal(checks.find((check) => check.id === "nginx")?.detail, "Requires WSL2 / Ubuntu");
  });

  it("treats a missing wsl.exe as not installed", () => {
    const checks = probeSetup(
      context({
        platform: "win32",
        isNativeWindows: true,
        run: () => result(1, "", "spawn wsl.exe ENOENT"),
      }),
    );
    assert.equal(checks.find((check) => check.id === "wsl")?.repair, "install-wsl");
  });

  it("probes packages inside Ubuntu when WSL2 is present", () => {
    const run: Runner = (_command, args = []) => {
      const joined = args.join(" ");
      if (args[0] === "-l" && args.includes("-v")) {
        return result(0, "  NAME      STATE    VERSION\n* Ubuntu    Running  2\n");
      }
      if (args[0] === "--status") return result(0, "Default Version: 2\n");
      if (joined.includes("node -v")) return result(0, "v22.14.0\n");
      if (joined.includes("command -v nginx")) return result(0, "/usr/sbin/nginx\n");
      if (joined.includes("initdb") || joined.includes("pg_ctl") || joined.includes("psql") || joined.includes("createdb")) {
        return result(0, "");
      }
      if (joined.includes("redis-server") || joined.includes("redis-cli")) return result(0, "");
      return result(1, "");
    };
    const checks = probeSetup(
      context({
        platform: "win32",
        isNativeWindows: true,
        run,
      }),
    );
    assert.equal(isReady(checks), true);
    assert.equal(checks.find((check) => check.id === "wsl")?.status, "ok");
    assert.equal(checks.find((check) => check.id === "node")?.detail.includes("v22.14.0"), true);
  });
});

describe("applySetup", () => {
  it("is a no-op when every check is already ok", () => {
    const calls: string[] = [];
    const ctx = context({
      which: (bin) => (bin === "nginx" ? "/usr/sbin/nginx" : null),
      hasPostgres: () => true,
      hasRedis: () => true,
      run: (command) => {
        calls.push(command);
        return result(0, "");
      },
    });
    const outcome = applySetup(ctx, probeSetup(ctx));
    assert.deepEqual(outcome.repairs, []);
    assert.equal(calls.length, 0);
  });

  it("elevates wsl --install and asks for a reboot when WSL is missing", () => {
    const commands: string[] = [];
    const ctx = context({
      platform: "win32",
      isNativeWindows: true,
      run: (command, args = []) => {
        commands.push([command, ...args].join(" "));
        if (command === "powershell.exe") return result(0, "");
        return result(1, "", "The Windows Subsystem for Linux is not installed. You can install by running: wsl.exe --install");
      },
    });
    const outcome = applySetup(ctx, probeSetup(ctx));
    assert.equal(outcome.reboot, true);
    assert.deepEqual(outcome.repairs, ["install-wsl"]);
    assert.match(outcome.message ?? "", /Reboot Windows/);
    assert.equal(commands.some((line) => line.includes("Start-Process") && line.includes("wsl.exe")), true);
  });
});
