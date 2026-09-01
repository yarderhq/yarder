import type { CheckId, SetupCheck, SetupContext } from "./types.ts";

export const LINUX_PACKAGES: Record<"nginx" | "postgres" | "redis", string[]> = {
  nginx: ["nginx"],
  postgres: ["postgresql", "postgresql-contrib"],
  redis: ["redis-server"],
};

export function aptInstallScript(missing: Array<"nginx" | "postgres" | "redis">): string {
  const pkgs = [...new Set(missing.flatMap((id) => LINUX_PACKAGES[id]))];
  if (!pkgs.includes("curl")) pkgs.push("curl");
  if (!pkgs.includes("ca-certificates")) pkgs.push("ca-certificates");
  return `export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y ${pkgs.join(" ")}`;
}

export const NODE_SOURCE_SCRIPT = `
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y curl ca-certificates
fi
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
`.trim();

export function missingUnixPackages(checks: SetupCheck[]): Array<"nginx" | "postgres" | "redis"> {
  const ids: CheckId[] = ["nginx", "postgres", "redis"];
  return ids.filter((id) => checks.some((check) => check.id === id && check.status !== "ok")) as Array<
    "nginx" | "postgres" | "redis"
  >;
}

export function installAptPackages(ctx: SetupContext, checks: SetupCheck[]): void {
  if (!ctx.hasDebian) {
    throw new Error(
      "yarder setup supports Debian/Ubuntu (apt) on Linux. Install nginx, postgresql, and redis-server, then re-run `yarder setup --check`.",
    );
  }
  const missing = missingUnixPackages(checks);
  if (missing.length === 0) return;
  const script = aptInstallScript(missing);
  ctx.log(`Installing ${missing.join(", ")} with apt...`);
  const result = ctx.run("sudo", ["bash", "-lc", script], { inheritStdio: true });
  if (result.status !== 0) {
    throw new Error("apt-get install failed. Re-run `yarder setup` after fixing the error above.");
  }
}

export function installNodeApt(ctx: SetupContext): void {
  if (!ctx.hasDebian) {
    throw new Error("Cannot install Node 22 automatically on this distro. Install Node 22, then re-run `yarder setup --check`.");
  }
  ctx.log("Installing Node 22 via NodeSource...");
  const result = ctx.run("sudo", ["bash", "-lc", NODE_SOURCE_SCRIPT], { inheritStdio: true });
  if (result.status !== 0) {
    throw new Error("Node 22 install failed. Re-run `yarder setup` after installing Node 22.");
  }
}
