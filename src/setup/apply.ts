import { output } from "./run.ts";
import { brewInstall } from "./macos.ts";
import { installAptPackages, installNodeApt } from "./linux.ts";
import { isReady, probeSetup } from "./probe.ts";
import type { ApplyOutcome, SetupCheck, SetupContext } from "./types.ts";
import {
  explainWslFailure,
  installWsl,
  pickDistro,
  probeWsl,
  provisionWsl,
} from "./windows.ts";

export function applySetup(ctx: SetupContext, checks: SetupCheck[]): ApplyOutcome {
  if (isReady(checks)) {
    return { repairs: [] };
  }

  if (ctx.isNativeWindows) {
    return applyWindows(ctx, checks);
  }
  if (ctx.platform === "darwin") {
    return applyMacos(ctx, checks);
  }
  if (ctx.platform === "linux") {
    return applyLinux(ctx, checks);
  }
  return {
    repairs: [],
    failed: true,
    message: `Unsupported platform ${ctx.platform}. Use WSL2, macOS, or Linux.`,
  };
}

function applyWindows(ctx: SetupContext, checks: SetupCheck[]): ApplyOutcome {
  const wslCheck = checks.find((check) => check.id === "wsl");
  if (wslCheck && wslCheck.status !== "ok") {
    if (wslCheck.repair === "install-wsl") {
      const result = installWsl(ctx);
      if (result.status !== 0) {
        return { repairs: ["install-wsl"], failed: true, message: explainWslFailure(result) };
      }
      return {
        repairs: ["install-wsl"],
        reboot: true,
        message: "Reboot Windows, then run `yarder setup` again.",
      };
    }
    if (wslCheck.repair === "install-ubuntu") {
      const result = installWsl(ctx);
      if (result.status !== 0) {
        return { repairs: ["install-ubuntu"], failed: true, message: explainWslFailure(result) };
      }
      const again = probeWsl(ctx);
      if (!again.selected) {
        return {
          repairs: ["install-ubuntu"],
          message:
            "Open Ubuntu from the Start menu once to finish first-time setup, then run `yarder setup` again.",
        };
      }
    }
    if (wslCheck.repair === "set-wsl-version") {
      const listed = probeWsl(ctx);
      const target = listed.distros.find((distro) => /^Ubuntu/i.test(distro.name)) ?? listed.distros[0];
      if (!target) {
        return { repairs: ["set-wsl-version"], failed: true, message: "No WSL distro found to convert to version 2." };
      }
      ctx.log(`Setting ${target.name} to WSL2...`);
      const result = ctx.run("wsl.exe", ["--set-version", target.name, "2"], { inheritStdio: true });
      if (result.status !== 0) {
        return {
          repairs: ["set-wsl-version"],
          failed: true,
          message: `Could not set WSL version 2 for ${target.name}. ${output(result).trim()}`.trim(),
        };
      }
    }
  }

  const afterWsl = probeWsl(ctx);
  const distro = afterWsl.selected ?? pickDistro(afterWsl.distros);
  if (!distro) {
    return {
      repairs: wslCheck?.repair ? [wslCheck.repair] : [],
      message: "Open Ubuntu from the Start menu once to finish first-time setup, then run `yarder setup` again.",
    };
  }

  const current = probeSetup(ctx);
  const needsProvision = current.some(
    (check) => check.id !== "wsl" && check.status !== "ok" && check.repair === "provision-wsl",
  );
  if (needsProvision) {
    provisionWsl(ctx, distro.name, current);
    return { repairs: ["provision-wsl"] };
  }
  return { repairs: wslCheck?.repair && wslCheck.status !== "ok" ? [wslCheck.repair] : [] };
}

function applyLinux(ctx: SetupContext, checks: SetupCheck[]): ApplyOutcome {
  const repairs: ApplyOutcome["repairs"] = [];
  const node = checks.find((check) => check.id === "node");
  if (node?.repair === "install-node-nvm") {
    repairs.push("install-node-nvm");
    ctx.log("This shell uses nvm. Run: nvm install 22");
  } else if (node?.repair === "install-node-apt" && node.status !== "ok") {
    installNodeApt(ctx);
    repairs.push("install-node-apt");
  }

  if (checks.some((check) => check.repair === "apt-packages" && check.status !== "ok")) {
    installAptPackages(ctx, checks);
    repairs.push("apt-packages");
  } else if (
    checks.some((check) => ["nginx", "postgres", "redis"].includes(check.id) && check.status !== "ok") &&
    !ctx.hasDebian
  ) {
    return {
      repairs,
      failed: true,
      message:
        "yarder setup supports Debian/Ubuntu (apt) on Linux. Install nginx, postgresql, and redis-server, then re-run `yarder setup --check`.",
    };
  }
  return { repairs };
}

function applyMacos(ctx: SetupContext, checks: SetupCheck[]): ApplyOutcome {
  const repairs: ApplyOutcome["repairs"] = [];
  const node = checks.find((check) => check.id === "node");
  if (node && node.status !== "ok") {
    ctx.log("Install Node 22 from https://nodejs.org then run `yarder setup` again.");
  }
  if (checks.some((check) => check.repair === "brew-packages" && check.status !== "ok")) {
    brewInstall(ctx, checks);
    repairs.push("brew-packages");
  } else if (
    checks.some((check) => ["nginx", "postgres", "redis"].includes(check.id) && check.status !== "ok") &&
    !ctx.hasHomebrew
  ) {
    return {
      repairs,
      failed: true,
      message: "Homebrew is not installed. Install it from https://brew.sh then run `yarder setup` again.",
    };
  }
  return { repairs };
}
