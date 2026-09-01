import type { SetupCheck, SetupContext } from "./types.ts";
import { missingUnixPackages } from "./linux.ts";

const BREW_FORMULAE: Record<"nginx" | "postgres" | "redis", string> = {
  nginx: "nginx",
  postgres: "postgresql@16",
  redis: "redis",
};

export function brewInstall(ctx: SetupContext, checks: SetupCheck[]): void {
  if (!ctx.hasHomebrew) {
    throw new Error(
      "Homebrew is not installed. Install it from https://brew.sh then run `yarder setup` again.",
    );
  }
  const missing = missingUnixPackages(checks);
  if (missing.length === 0) return;
  const formulae = missing.map((id) => BREW_FORMULAE[id]);
  ctx.log(`Installing ${formulae.join(", ")} with Homebrew...`);
  const result = ctx.run("brew", ["install", ...formulae], { inheritStdio: true });
  if (result.status !== 0) {
    throw new Error("brew install failed. Re-run `yarder setup` after fixing the error above.");
  }
}
