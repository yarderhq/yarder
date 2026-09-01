import fs from "node:fs";
import os from "node:os";

export function isWsl(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    return /microsoft|wsl/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

export function isNativeWindows(): boolean {
  return process.platform === "win32";
}

export function supportsHostnameRouting(): boolean {
  return process.platform === "darwin" || process.platform === "linux" || isWsl();
}

export function windowsRoutingMessage(): string {
  return "Native Windows is not supported for hostname routing. Run `yarder setup` to install WSL2, then use yarder from Ubuntu. Services are still reachable on localhost ports.";
}

export function platformSummary() {
  return {
    os: process.platform,
    arch: process.arch,
    release: os.release(),
    nativeWindows: isNativeWindows(),
    wsl: isWsl(),
    hostnameRouting: supportsHostnameRouting(),
  };
}
