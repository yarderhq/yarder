import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { AGENT_PORT } from "../config/constants.ts";
import { upsertRemote, type RemoteRecord } from "./remotes.ts";
import { formatSshTarget, parseSshTarget, scpUpload, shQuote, sshExec, sshExecOrThrow } from "./ssh.ts";
import { findFreePort } from "./tunnel.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type AddRemoteOptions = {
  name: string;
  ssh: string;
  domain?: string;
  dir?: string;
  port?: number;
  log?: (msg: string) => void;
};

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function provisionScript(input: { token: string; domain?: string; dirHint?: string }): string {
  const dirHint = input.dirHint ? shQuote(input.dirHint) : "''";
  const hostname = input.domain ?? "";
  return `set -euo pipefail
if [ "$(uname -s)" != "Linux" ]; then
  echo "yarder remote provision supports Linux (Ubuntu 22.04/24.04)." >&2
  exit 1
fi
if ! command -v apt-get >/dev/null 2>&1; then
  echo "yarder remote provision requires Debian/Ubuntu (apt)." >&2
  exit 1
fi
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo -n"
  if ! $SUDO true >/dev/null 2>&1; then
    echo "Passwordless sudo is required for nginx/certbot (or SSH as root)." >&2
    exit 1
  fi
fi
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 22 ]; then
  if ! command -v curl >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y curl ca-certificates
  fi
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi
$SUDO apt-get update -y
$SUDO apt-get install -y nginx postgresql postgresql-contrib redis-server curl ca-certificates tar python3-certbot-nginx
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2
fi
if [ "$(id -u)" -eq 0 ]; then
  APP_ROOT=/var/yarder/apps
  STATE_DIR=/var/yarder
else
  APP_ROOT="$HOME/yarder/apps"
  STATE_DIR="$HOME/.yarder"
fi
if [ -n ${dirHint} ]; then
  APP_ROOT=${dirHint}
fi
$SUDO mkdir -p "$APP_ROOT" /var/lib/yarder/acme "$STATE_DIR"
$SUDO mkdir -p /var/lib/yarder/acme/.well-known/acme-challenge
if [ "$(id -u)" -ne 0 ]; then
  $SUDO chown -R "$(id -u):$(id -g)" "$APP_ROOT" "$STATE_DIR" /var/lib/yarder/acme || true
  NGINX_BIN="$(command -v nginx || echo /usr/sbin/nginx)"
  CERTBOT_BIN="$(command -v certbot || echo /usr/bin/certbot)"
  echo "$(whoami) ALL=(root) NOPASSWD: $NGINX_BIN, $CERTBOT_BIN" | $SUDO tee /etc/sudoers.d/yarder >/dev/null
  $SUDO chmod 440 /etc/sudoers.d/yarder
fi
mkdir -p "$STATE_DIR"
cat > "$STATE_DIR/agent.env" <<EOF
YARDER_ENV=production
NODE_ENV=production
YARDER_AGENT_TOKEN=${input.token}
YARDER_AGENT_HOST=127.0.0.1
YARDER_AGENT_PORT=${AGENT_PORT}
YARDER_HOSTNAME=${hostname}
YARDER_HOME=$STATE_DIR
EOF
echo "YARDER_DIR=$APP_ROOT"
echo "YARDER_STATE=$STATE_DIR"
echo "YARDER_DOMAIN=${hostname}"
`;
}

function parseProvisionOut(stdout: string): { dir: string; stateDir: string } {
  const dir = stdout.match(/^YARDER_DIR=(.*)$/m)?.[1]?.trim();
  const stateDir = stdout.match(/^YARDER_STATE=(.*)$/m)?.[1]?.trim();
  if (!dir || !stateDir) {
    throw new Error(`Remote provision did not report install paths.\n${stdout}`);
  }
  return { dir, stateDir };
}

function packCli(log: (msg: string) => void): string {
  log("Building GUI and packing yarder CLI...");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (build.status !== 0) {
    throw new Error(build.stderr || build.stdout || "vite build failed");
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yarder-pack-"));
  const pack = spawnSync("npm", ["pack", "--pack-destination", tmp], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if (pack.status !== 0) {
    throw new Error(pack.stderr || pack.stdout || "npm pack failed");
  }
  const tgz = fs.readdirSync(tmp).find((name) => name.endsWith(".tgz"));
  if (!tgz) throw new Error("npm pack did not produce a tarball");
  return path.join(tmp, tgz);
}

function startAgentScript(stateDir: string, tarballRemote: string): string {
  const envFile = shQuote(`${stateDir}/agent.env`);
  const helper = shQuote(`${stateDir}/write-ecosystem.cjs`);
  const ecosystem = shQuote(`${stateDir}/ecosystem.json`);
  const tarball = shQuote(tarballRemote);
  return `set -euo pipefail
set -a
. ${envFile}
set +a
npm install -g ${tarball}
YARDER_BIN="$(command -v yarder)"
cat > ${helper} <<'END'
const fs = require("fs");
fs.writeFileSync(process.argv[2], JSON.stringify({
  apps: [{
    name: "yarder-agent",
    script: process.argv[3],
    args: "agent",
    env: {
      YARDER_ENV: "production",
      NODE_ENV: "production",
      YARDER_AGENT_TOKEN: process.env.YARDER_AGENT_TOKEN,
      YARDER_AGENT_HOST: "127.0.0.1",
      YARDER_AGENT_PORT: process.env.YARDER_AGENT_PORT || "3847",
      YARDER_HOSTNAME: process.env.YARDER_HOSTNAME || "",
      YARDER_HOME: process.env.YARDER_HOME,
      HOME: process.env.HOME,
      PATH: process.env.PATH
    }
  }]
}, null, 2));
END
node ${helper} ${shQuote(`${stateDir}/ecosystem.json`)} "$YARDER_BIN"
pm2 delete yarder-agent >/dev/null 2>&1 || true
pm2 start ${ecosystem}
STARTUP="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" | tail -n 1 || true)"
if [ -n "$STARTUP" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    bash -lc "$STARTUP" || true
  else
    sudo -n bash -lc "$STARTUP" || true
  fi
fi
pm2 save
rm -f ${tarball}
echo "YARDER_AGENT=ok"
`;
}

export async function addRemote(opts: AddRemoteOptions): Promise<RemoteRecord> {
  const log = opts.log ?? console.log;
  const target = parseSshTarget(opts.ssh, opts.port);
  const token = generateToken();
  log(`Connecting to ${formatSshTarget(target)}...`);
  const probe = sshExec(target, "uname -s");
  if (probe.status !== 0) {
    throw new Error(probe.stderr.trim() || "Could not SSH to the server. Check the host, user, and key-based auth.");
  }
  if (probe.stdout.trim() !== "Linux") {
    throw new Error(`Remote OS is ${probe.stdout.trim() || "unknown"}; Ubuntu 22.04/24.04 is required.`);
  }
  log("Installing Node 22, nginx, PM2, Postgres, Redis, and certbot...");
  const provision = sshExec(target, `bash -lc ${shQuote(provisionScript({ token, domain: opts.domain, dirHint: opts.dir }))}`);
  if (provision.status !== 0) {
    throw new Error(provision.stderr.trim() || provision.stdout.trim() || "Remote provision failed");
  }
  const paths = parseProvisionOut(`${provision.stdout}\n${provision.stderr}`);
  const tarball = packCli(log);
  const remoteTgz = `/tmp/yarder-${path.basename(tarball)}`;
  log("Uploading yarder agent...");
  scpUpload(target, tarball, remoteTgz);
  log("Starting yarder-agent with PM2...");
  sshExecOrThrow(target, `bash -lc ${shQuote(startAgentScript(paths.stateDir, remoteTgz))}`, { inheritStdio: true });
  const localTunnelPort = await findFreePort(13847);
  const record: RemoteRecord = {
    ssh: formatSshTarget(target),
    port: target.port,
    dir: paths.dir,
    token,
    domain: opts.domain,
    agentPort: AGENT_PORT,
    localTunnelPort,
  };
  upsertRemote(opts.name, record);
  log(`Saved remote "${opts.name}" → ${record.ssh} (${record.dir})`);
  return record;
}
