import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ACME_WEBROOT, slugify } from "../config/constants.ts";
import type { ResolvedProject } from "../config/resolve.ts";
import { isNativeWindows, supportsHostnameRouting, windowsRoutingMessage } from "./platform.ts";
import { privilegedOutput, runPrivileged } from "./sudo.ts";

export type RoutingResult = {
  applied: boolean;
  skipped?: string;
  warning?: string;
  hosts: string[];
  configDir: string;
};

export type ServerBlockOpts = {
  tls?: { cert: string; key: string };
  acmeRoot?: string;
  redirectHttp?: boolean;
};

export function nginxSiteName(projectName: string, serviceName: string): string {
  return `yarder-${slugify(projectName)}-${slugify(serviceName)}.conf`;
}

export function projectCertName(projectName: string): string {
  return `yarder-${slugify(projectName)}`;
}

export function projectCertDir(projectName: string): string {
  return `/etc/letsencrypt/live/${projectCertName(projectName)}`;
}

export function readProjectTls(projectName: string): { cert: string; key: string } | undefined {
  const dir = projectCertDir(projectName);
  const cert = path.join(dir, "fullchain.pem");
  const key = path.join(dir, "privkey.pem");
  if (fs.existsSync(cert) && fs.existsSync(key)) {
    return { cert, key };
  }
  return undefined;
}

export function routedHostnames(project: ResolvedProject): string[] {
  const hosts: string[] = [];
  for (const service of Object.values(project.services)) {
    if (service.kind === "process" && service.hostname && service.port) {
      hosts.push(service.hostname);
    }
  }
  return hosts;
}

export function renderServerBlock(hostname: string, port: number, opts: ServerBlockOpts = {}): string {
  const proxy = `location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`;

  const acme = opts.acmeRoot
    ? `location /.well-known/acme-challenge/ {
        alias ${opts.acmeRoot.replaceAll("\\", "/")}/.well-known/acme-challenge/;
    }`
    : "";

  if (opts.tls) {
    const httpLocation = opts.redirectHttp
      ? `location / {
        return 301 https://$host$request_uri;
    }`
      : proxy;
    return `server {
    listen 80;
    server_name ${hostname};
    ${acme}
    ${httpLocation}
}

server {
    listen 443 ssl;
    server_name ${hostname};
    ssl_certificate ${opts.tls.cert.replaceAll("\\", "/")};
    ssl_certificate_key ${opts.tls.key.replaceAll("\\", "/")};
    ${proxy}
}
`;
  }

  return `server {
    listen 80;
    server_name ${hostname};
    ${acme}
    ${proxy}
}
`;
}

function writeGeneratedConfigs(
  project: ResolvedProject,
  opts: ServerBlockOpts = {},
): { configDir: string; hosts: string[] } {
  const configDir = path.join(project.runtimeDir, "nginx");
  fs.mkdirSync(configDir, { recursive: true });
  const hosts: string[] = [];
  const includes: string[] = [];
  const tls = opts.tls ?? (project.envName === "production" ? readProjectTls(project.name) : undefined);
  const acmeRoot = opts.acmeRoot ?? (project.envName === "production" ? ACME_WEBROOT : undefined);

  for (const service of Object.values(project.services)) {
    if (service.kind !== "process" || !service.hostname || !service.port) continue;
    const filename = nginxSiteName(project.name, service.name);
    fs.writeFileSync(
      path.join(configDir, filename),
      renderServerBlock(service.hostname, service.port, {
        tls,
        acmeRoot,
        redirectHttp: Boolean(tls),
      }),
    );
    includes.push(`include ${path.join(configDir, filename).replaceAll("\\", "/")};`);
    hosts.push(service.hostname);
  }

  const master = `worker_processes 1;
error_log ${path.join(configDir, "error.log").replaceAll("\\", "/")};
pid ${path.join(configDir, "nginx.pid").replaceAll("\\", "/")};
events { worker_connections 64; }
http {
    access_log ${path.join(configDir, "access.log").replaceAll("\\", "/")};
    ${includes.join("\n    ")}
}
`;
  fs.writeFileSync(path.join(configDir, "nginx.conf"), master);
  return { configDir, hosts };
}

function trySystemNginx(project: ResolvedProject, configDir: string, privileged: boolean): string | undefined {
  const sitesAvailable = "/etc/nginx/sites-available";
  const sitesEnabled = "/etc/nginx/sites-enabled";
  if (!fs.existsSync(sitesAvailable) || !fs.existsSync(sitesEnabled)) {
    return "System nginx sites-available not found. Generated configs are in .yarder/nginx.";
  }

  try {
    for (const service of Object.values(project.services)) {
      if (service.kind !== "process" || !service.hostname || !service.port) continue;
      const name = nginxSiteName(project.name, service.name);
      const source = path.join(configDir, name);
      const dest = path.join(sitesAvailable, name);
      const enabled = path.join(sitesEnabled, name);
      if (privileged) {
        const copy = runPrivileged("cp", [source, dest]);
        if (copy.status !== 0) {
          return `Could not install nginx site ${dest}: ${privilegedOutput(copy)}`;
        }
        if (!fs.existsSync(enabled)) {
          const link = runPrivileged("ln", ["-sfn", dest, enabled]);
          if (link.status !== 0) {
            return `Could not enable nginx site ${name}: ${privilegedOutput(link)}`;
          }
        }
      } else {
        fs.copyFileSync(source, dest);
        if (!fs.existsSync(enabled)) {
          fs.symlinkSync(dest, enabled);
        }
      }
    }
    const test = privileged ? runPrivileged("nginx", ["-t"]) : spawnEncoded("nginx", ["-t"]);
    if (test.status !== 0) {
      return `nginx -t failed: ${privilegedOutput(test)}`;
    }
    const reload = privileged ? runPrivileged("nginx", ["-s", "reload"]) : spawnEncoded("nginx", ["-s", "reload"]);
    if (reload.status !== 0) {
      return `nginx reload failed: ${privilegedOutput(reload)}. Generated configs are in .yarder/nginx.`;
    }
  } catch (err) {
    return `Could not apply system nginx configs (${err instanceof Error ? err.message : err}). Generated files are in .yarder/nginx. You may need sudo.`;
  }
  return undefined;
}

function spawnEncoded(command: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function applyNginx(project: ResolvedProject): { configDir: string; hosts: string[]; warning?: string } {
  const { configDir, hosts } = writeGeneratedConfigs(project);
  if (hosts.length === 0) {
    return { configDir, hosts };
  }
  if (project.envName === "production") {
    const warning = trySystemNginx(project, configDir, true);
    return { configDir, hosts, warning };
  }
  if (!supportsHostnameRouting()) {
    return { configDir, hosts, warning: windowsRoutingMessage() };
  }
  const warning = trySystemNginx(project, configDir, false);
  return { configDir, hosts, warning };
}

function hostsFilePath(): string {
  if (isNativeWindows()) {
    return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");
  }
  return "/etc/hosts";
}

function blockMarkers(projectName: string): { start: string; end: string } {
  return {
    start: `# yarder-start:${projectName}`,
    end: `# yarder-end:${projectName}`,
  };
}

export function applyHosts(project: ResolvedProject, hosts: string[]): { applied: boolean; warning?: string } {
  if (hosts.length === 0) {
    return { applied: true };
  }
  if (!supportsHostnameRouting()) {
    return { applied: false, warning: windowsRoutingMessage() };
  }

  const file = hostsFilePath();
  const { start, end } = blockMarkers(project.name);
  const block = `${start}\n127.0.0.1 ${hosts.join(" ")}\n${end}\n`;

  try {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const stripped = current.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n?`, "g"), "");
    fs.writeFileSync(file, `${stripped.trimEnd()}\n\n${block}`);
    return { applied: true };
  } catch (err) {
    const tmp = path.join(os.tmpdir(), `yarder-hosts-${project.name}`);
    fs.writeFileSync(tmp, block);
    return {
      applied: false,
      warning: `Could not update ${file} (${err instanceof Error ? err.message : err}). Add these hosts to ${file} (may need sudo):\n${block.trim()}`,
    };
  }
}

export function applyRouting(project: ResolvedProject): RoutingResult {
  if (project.envName === "production") {
    if (routedHostnames(project).length === 0) {
      const generated = writeGeneratedConfigs(project);
      return {
        applied: false,
        skipped: "No production domain; services are on localhost ports only. Pass --domain or set hostname in yarder.yaml.",
        hosts: generated.hosts,
        configDir: generated.configDir,
      };
    }
    const nginx = applyNginx(project);
    return {
      applied: !nginx.warning,
      warning: nginx.warning,
      hosts: nginx.hosts,
      configDir: nginx.configDir,
    };
  }

  if (isNativeWindows() && !supportsHostnameRouting()) {
    const generated = writeGeneratedConfigs(project);
    return {
      applied: false,
      skipped: windowsRoutingMessage(),
      hosts: generated.hosts,
      configDir: generated.configDir,
    };
  }

  const nginx = applyNginx(project);
  const hosts = applyHosts(project, nginx.hosts);
  const warning = [nginx.warning, hosts.warning].filter(Boolean).join("\n") || undefined;
  return {
    applied: !warning,
    warning,
    hosts: nginx.hosts,
    configDir: nginx.configDir,
  };
}
