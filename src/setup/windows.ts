import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeMeetsEngine } from "./node-version.ts";
import { output } from "./run.ts";
import { aptInstallScript, missingUnixPackages, NODE_SOURCE_SCRIPT } from "./linux.ts";
import type { RunResult, SetupCheck, SetupContext } from "./types.ts";

export type WslDistro = {
  name: string;
  state: string;
  version: string;
  isDefault: boolean;
};

export type WslProbe = {
  installed: boolean;
  distros: WslDistro[];
  selected?: WslDistro;
  error?: string;
  raw: string;
};

export function normalizeWslText(text: string): string {
  if (text.includes("\u0000")) {
    return text.replace(/\u0000/g, "");
  }
  return text;
}

export function parseWslList(raw: string): WslDistro[] {
  const text = normalizeWslText(raw);
  const distros: WslDistro[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/no installed distributions/i.test(trimmed)) return [];
    if (/^(NAME|Windows Subsystem|The Windows|Use |wsl\.exe|Copyright|Subscriptions)/i.test(trimmed)) {
      continue;
    }
    const isDefault = /^\*/.test(trimmed);
    const rest = trimmed.replace(/^\*\s*/, "");
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length < 3) continue;
    const version = parts[parts.length - 1];
    const state = parts[parts.length - 2];
    const name = parts.slice(0, -2).join(" ");
    if (!/^\d+$/.test(version)) continue;
    distros.push({ name, state, version, isDefault });
  }
  return distros;
}

export function pickDistro(distros: WslDistro[]): WslDistro | undefined {
  const v2 = distros.filter((distro) => distro.version === "2");
  return v2.find((distro) => /^Ubuntu/i.test(distro.name)) ?? v2.find((distro) => distro.isDefault) ?? v2[0];
}

export function windowsPathToWsl(winPath: string): string {
  const normalized = winPath.replace(/\//g, "\\");
  const match = normalized.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return winPath.replace(/\\/g, "/");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function wslBin(): string {
  return "wsl.exe";
}

function wslArgs(args: string[]): { command: string; args: string[] } {
  return { command: wslBin(), args };
}

export function wslList(ctx: SetupContext): RunResult {
  const utf8 = ctx.run(wslBin(), ["-l", "-v", "--utf8"]);
  const combined = output(utf8);
  if (utf8.status === 0 || !/unknown|invalid|unrecognized/i.test(combined)) {
    return {
      status: utf8.status,
      stdout: normalizeWslText(utf8.stdout),
      stderr: normalizeWslText(utf8.stderr),
    };
  }
  const fallback = ctx.run(wslBin(), ["-l", "-v"]);
  return {
    status: fallback.status,
    stdout: normalizeWslText(fallback.stdout),
    stderr: normalizeWslText(fallback.stderr),
  };
}

function looksUninstalled(text: string, status: number | null): boolean {
  if (/not installed|wsl\.exe --install|wslexe --install|enoent|not recognized|cannot find/i.test(text)) {
    return true;
  }
  return status !== 0 && !text.trim();
}

export function probeWsl(ctx: SetupContext): WslProbe {
  const listed = wslList(ctx);
  const status = ctx.run(wslBin(), ["--status"]);
  const raw = `${output(listed)}\n${output(status)}`;
  if (looksUninstalled(raw, listed.status ?? status.status)) {
    return { installed: false, distros: [], raw, error: "WSL is not installed." };
  }
  const distros = parseWslList(raw);
  const selected = pickDistro(distros);
  return { installed: true, distros, selected, raw };
}

export function wslBash(
  ctx: SetupContext,
  distro: string,
  script: string,
  inheritStdio = false,
): RunResult {
  const { command, args } = wslArgs(["-d", distro, "-u", "root", "--", "bash", "-lc", script]);
  return ctx.run(command, args, { inheritStdio });
}

export function wslHasBin(ctx: SetupContext, distro: string, bin: string): boolean {
  const extra =
    bin === "initdb" || bin === "pg_ctl" || bin === "psql" || bin === "createdb"
      ? ` || ls /usr/lib/postgresql/*/bin/${bin} >/dev/null 2>&1`
      : "";
  const result = wslBash(ctx, distro, `command -v ${bin} >/dev/null 2>&1${extra}`);
  return result.status === 0;
}

export function wslNodeVersion(ctx: SetupContext, distro: string): string | null {
  const result = wslBash(ctx, distro, "node -v");
  const version = result.stdout.trim() || result.stderr.trim();
  if (result.status !== 0 || !version) return null;
  return version.split(/\s+/)[0] ?? null;
}

export function wslHasyarder(ctx: SetupContext, distro: string): boolean {
  return wslBash(ctx, distro, "command -v yarder").status === 0;
}

export function installWsl(ctx: SetupContext): RunResult {
  ctx.log("Installing WSL2 and Ubuntu (Administrator approval required)...");
  return ctx.run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Start-Process -FilePath 'wsl.exe' -ArgumentList '--install','-d','Ubuntu','--no-launch' -Verb RunAs -Wait",
    ],
    { inheritStdio: true },
  );
}

export function explainWslFailure(result: RunResult): string {
  const text = output(result);
  if (/virtualization|hypervisor|VT-x|SVM/i.test(text)) {
    return `WSL install failed because virtualization is disabled. Enable it in BIOS/UEFI, then run \`yarder setup\` again.\n${text.trim()}`.trim();
  }
  if (result.status !== 0) {
    return `WSL install failed${text.trim() ? `:\n${text.trim()}` : ". If you cancelled the Administrator prompt, run `yarder setup` again."}`;
  }
  return text.trim();
}

export function provisionWsl(ctx: SetupContext, distro: string, checks: SetupCheck[]): void {
  const missing = missingUnixPackages(checks);
  if (missing.length > 0) {
    ctx.log(`Installing ${missing.join(", ")} inside ${distro}...`);
    const apt = wslBash(ctx, distro, aptInstallScript(missing), true);
    if (apt.status !== 0) {
      throw new Error(`Could not install packages inside ${distro}. ${output(apt).trim()}`.trim());
    }
  }

  const nodeCheck = checks.find((check) => check.id === "node");
  if (nodeCheck && nodeCheck.status !== "ok") {
    ctx.log(`Installing Node 22 inside ${distro}...`);
    const node = wslBash(ctx, distro, NODE_SOURCE_SCRIPT, true);
    if (node.status !== 0) {
      throw new Error(`Could not install Node 22 inside ${distro}. ${output(node).trim()}`.trim());
    }
  }

  const version = wslNodeVersion(ctx, distro);
  if (!version || !nodeMeetsEngine(version)) {
    throw new Error(`Node 22 is not available inside ${distro} after setup.`);
  }

  if (!wslHasyarder(ctx, distro)) {
    const warning = installyarderInWsl(ctx, distro);
    if (warning) ctx.log(warning);
  }
}

export function installyarderInWsl(ctx: SetupContext, distro: string): string | undefined {
  const pkg = path.join(ctx.packageRoot, "package.json");
  if (!fs.existsSync(pkg)) {
    return "Could not find the yarder package root. Inside WSL run: npm install -g yarder";
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yarder-pack-"));
  ctx.log("Packing yarder and installing it inside WSL...");
  const packed = ctx.run("npm", ["pack", "--pack-destination", tmp], { cwd: ctx.packageRoot });
  if (packed.status !== 0) {
    return "Could not pack yarder. Inside WSL run: npm install -g yarder";
  }
  const tgz = fs.readdirSync(tmp).find((name) => name.endsWith(".tgz"));
  if (!tgz) {
    return "Could not pack yarder. Inside WSL run: npm install -g yarder";
  }
  const winPath = path.join(tmp, tgz);
  const translated = ctx.run(wslBin(), ["wslpath", "-a", winPath]);
  const wslPath = translated.status === 0 && translated.stdout.trim()
    ? translated.stdout.trim()
    : windowsPathToWsl(winPath);
  const installed = ctx.run(wslBin(), ["-d", distro, "-u", "root", "--", "npm", "install", "-g", wslPath], {
    inheritStdio: true,
  });
  if (installed.status !== 0) {
    return "Could not install yarder inside WSL. Inside Ubuntu run: npm install -g yarder";
  }
  return undefined;
}

export function projectWslPath(ctx: SetupContext): string {
  const translated = ctx.run(wslBin(), ["wslpath", "-a", ctx.cwd]);
  if (translated.status === 0 && translated.stdout.trim()) {
    return translated.stdout.trim();
  }
  return windowsPathToWsl(ctx.cwd);
}
