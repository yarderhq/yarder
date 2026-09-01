import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ACME_WEBROOT } from "../config/constants.ts";
import type { ResolvedProject } from "../config/resolve.ts";
import { applyRouting, projectCertDir, projectCertName, readProjectTls, routedHostnames } from "./nginx.ts";
import { privilegedOutput, runPrivileged } from "./sudo.ts";

export type TlsView = {
  status: "active" | "skipped" | "error" | "none";
  message?: string;
  expiry?: string;
  hosts: string[];
};

let lastTls: TlsView = { status: "none", hosts: [] };

export function currentTls(): TlsView {
  return lastTls;
}

export function setTls(view: TlsView): TlsView {
  lastTls = view;
  return lastTls;
}

export function certExpiry(projectName: string): string | undefined {
  const tls = readProjectTls(projectName);
  if (!tls) return undefined;
  const result = spawnSync("openssl", ["x509", "-enddate", "-noout", "-in", tls.cert], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const match = (result.stdout || "").trim().match(/^notAfter=(.*)$/);
  return match?.[1];
}

export function tlsStatusFor(project: ResolvedProject): TlsView {
  const hosts = routedHostnames(project);
  const expiry = certExpiry(project.name);
  if (expiry) {
    return { status: "active", expiry, hosts };
  }
  return lastTls.hosts.length > 0 || lastTls.status !== "none" ? lastTls : { status: "none", hosts };
}

export async function applyTls(project: ResolvedProject): Promise<TlsView> {
  const hosts = routedHostnames(project);
  if (project.envName !== "production") {
    return setTls({ status: "skipped", message: "TLS is production-only", hosts });
  }
  if (hosts.length === 0) {
    return setTls({
      status: "skipped",
      message: "No production hostnames; skip TLS. Pass --domain when adding the remote.",
      hosts,
    });
  }

  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["certbot"], { encoding: "utf8" });
  if (which.status !== 0) {
    return setTls({
      status: "skipped",
      message: "certbot is not installed. Install python3-certbot-nginx or skip TLS for HTTP-only deploy.",
      hosts,
    });
  }

  fs.mkdirSync(ACME_WEBROOT, { recursive: true });
  runPrivileged("mkdir", ["-p", ACME_WEBROOT]);
  applyRouting(project);

  const args = [
    "certonly",
    "--webroot",
    "-w",
    ACME_WEBROOT,
    "--cert-name",
    projectCertName(project.name),
    "-n",
    "--agree-tos",
    "--register-unsafely-without-email",
    "--keep-until-expiring",
    ...hosts.flatMap((host) => ["-d", host]),
  ];
  const result = runPrivileged("certbot", args);
  if (result.status !== 0) {
    const detail = privilegedOutput(result) || "certbot failed";
    return setTls({
      status: "skipped",
      message: `TLS skipped (HTTP still live): ${detail}`,
      hosts,
    });
  }

  if (!readProjectTls(project.name) && !fs.existsSync(path.join(projectCertDir(project.name), "fullchain.pem"))) {
    return setTls({
      status: "error",
      message: "certbot succeeded but certificate files were not found.",
      hosts,
    });
  }

  applyRouting(project);
  return setTls({
    status: "active",
    expiry: certExpiry(project.name),
    hosts,
  });
}
