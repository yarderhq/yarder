import { isReady } from "./probe.ts";
import type { SetupCheck, SetupContext } from "./types.ts";
import { projectWslPath } from "./windows.ts";

export function printChecklist(checks: SetupCheck[], log: (msg: string) => void = console.log): void {
  const width = Math.max(...checks.map((check) => check.label.length), 10);
  for (const check of checks) {
    log(`${check.label.padEnd(width + 2)}${check.status.padEnd(10)}${check.detail}`);
  }
}

export function printNextSteps(ctx: SetupContext, checks: SetupCheck[]): void {
  if (!isReady(checks)) return;
  ctx.log("");
  if (ctx.isNativeWindows) {
    const linuxPath = projectWslPath(ctx);
    ctx.log("Ready. Run yarder from Ubuntu:");
    ctx.log("  wsl");
    ctx.log(`  cd ${linuxPath}`);
    ctx.log("  yarder dev");
    ctx.log("");
    ctx.log("/mnt/c/... works but is slow. Prefer a clone under your Linux home (~/src/...).");
    return;
  }
  ctx.log("Ready. From your app repo: yarder dev");
}
