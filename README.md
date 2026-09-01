# yarder

Run your Node stack as native processes from one `yarder.yaml`. Local GUI. Deploy to a VPS you own. No Docker.

This is an early **0.1.1**. The CLI and yaml model work; polish and extras will move.

Source: [github.com/yarderhq/yarder](https://github.com/yarderhq/yarder).

## Requirements

- Node.js 22 or newer
- nginx, Postgres, and Redis via `yarder setup` (Homebrew or apt on macOS/Linux; WSL2 + Ubuntu on Windows)

yarder will not use Docker. Managed Postgres and Redis need those binaries on PATH.

## Install

```bash
npm i -g yarder
```

Or run without installing:

```bash
npx yarder
```

## Quick start

```bash
yarder setup          # WSL2 on Windows; nginx, Postgres, Redis on WSL/Linux/macOS
yarder setup --check
yarder init
yarder dev            # from a project with yarder.yaml
```

`yarder dev` starts native processes via PM2 in `depends_on` order, waits until each service is healthy, injects `.env` and discovery URLs, fails clearly on port clashes, and serves a thin GUI.

On Windows, hostname routing (nginx + `/etc/hosts`) needs WSL2. After `yarder setup`, run `yarder` from Ubuntu, not PowerShell. Prefer a clone under the Linux home; `/mnt/c/...` works but is slow.

## yarder.yaml

```yaml
name: myapp

services:
  web:
    command: npm run dev
    dir: .
    port: 3000
    depends_on:
      - api

  api:
    command: npm start
    dir: ./api
    port: 4000
    health: /health
    depends_on:
      - postgres

  postgres:
    type: postgres

  redis:
    type: redis
```

Optional per-service fields: `install` and `build` (deploy only), `dev` (`yarder dev` only), `env`.

## Commands

```bash
yarder init
yarder setup [--check]
yarder dev
yarder status
yarder logs [service]
yarder env
yarder restart [service]
yarder stop [service]
yarder remote add production user@your-vps --domain example.com
yarder deploy
yarder status --env production
yarder --help
```



## Deploy to a VPS

Target: Ubuntu 22.04/24.04 you can SSH into with key-based auth. OpenSSH on the laptop is enough (including Windows); WSL is not required for `yarder deploy`.

```bash
yarder remote add production deploy@your.vps.ip --domain example.com
yarder deploy
yarder status --env production
yarder logs api --env production
```

What that does:

1. Installs Node 22, nginx, PM2, Postgres, Redis, and certbot on the server if missing
2. Copies the yarder CLI to the server and starts `yarder-agent` on `127.0.0.1:3847` (token-authenticated; reached from your laptop via SSH tunnel)
3. Syncs the project (not `node_modules`) to `/var/yarder/apps/{name}` (or `~/yarder/apps/{name}`)
4. Runs per-service `install` (default `npm ci` / `npm install`) and optional `build`, then health-gated PM2 start
5. Writes nginx server blocks for `{service}.{domain}`. If DNS for those names points at the VPS, Certbot issues TLS; otherwise HTTP still works

Open ports 80 and 443 on the VPS. `.env` is copied with the project (not encrypted at rest). Production processes use PM2 `autorestart`.

## License

yarder is licensed under the [GNU Affero General Public License v3.0](LICENSE) only.

Apps you run or deploy *with* yarder stay yours. Using this CLI does not place your application under the AGPL. Contributions require signing the [CLA](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).