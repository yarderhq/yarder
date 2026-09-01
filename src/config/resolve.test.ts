import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { describeServiceEnv, resolveProject, startOrder } from "./resolve.ts";
import type { yarderConfig } from "./schema.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yarder-resolve-"));
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("resolveProject", () => {
  it("orders postgres then api then web and injects URLs", () => {
    const config: yarderConfig = {
      name: "basic",
      services: {
        web: { command: "node index.js", dir: "./web", port: 3007, depends_on: ["api"] },
        api: { command: "node index.js", dir: "./api", port: 4007, health: "/health", depends_on: ["postgres"] },
        postgres: { type: "postgres" },
        redis: { type: "redis" },
      },
    };
    const project = resolveProject(config, tmp);
    assert.deepEqual(startOrder(project), ["postgres", "redis", "api", "web"]);
    const api = project.services.api;
    assert.equal(api.kind, "process");
    if (api.kind !== "process") return;
    assert.equal(api.env.PORT, "4007");
    assert.equal(api.env.API_URL, "http://api.basic.test");
    assert.equal(api.env.WEB_URL, "http://web.basic.test");
    assert.equal(api.env.DATABASE_URL, "postgres://yarder@127.0.0.1:55432/basic");
    assert.equal(api.env.REDIS_URL, "redis://127.0.0.1:56379");
    assert.equal(api.health, "/health");
    assert.equal(api.envSources.DATABASE_URL, "injected");
    assert.equal(project.services.redis.kind, "redis");
  });

  it("lets injected discovery win over dotenv and yaml, and redacts secrets", () => {
    fs.writeFileSync(path.join(tmp, ".env"), "SECRET=from-file\nDATABASE_URL=from-dotenv\nSHARED=from-dotenv\n");
    const config: yarderConfig = {
      name: "envapp",
      services: {
        api: {
          command: "node index.js",
          dir: ".",
          port: 4000,
          env: { SHARED: "from-yaml", YAML_ONLY: "1" },
        },
        postgres: { type: "postgres" },
      },
    };
    const project = resolveProject(config, tmp);
    const api = project.services.api;
    assert.equal(api.kind, "process");
    if (api.kind !== "process") return;
    assert.equal(api.env.SECRET, "from-file");
    assert.equal(api.env.SHARED, "from-yaml");
    assert.equal(api.env.YAML_ONLY, "1");
    assert.equal(api.env.DATABASE_URL, "postgres://yarder@127.0.0.1:55432/envapp");
    assert.equal(api.envSources.DATABASE_URL, "injected");
    assert.equal(api.env.PORT, "4000");
    const view = describeServiceEnv(api);
    assert.equal(view.SECRET.value, "***");
    assert.equal(view.SHARED.value, "***");
    assert.equal(view.DATABASE_URL.value, "postgres://yarder@127.0.0.1:55432/envapp");
    assert.equal(view.PORT.value, "4000");
    assert.equal(view.API_URL.value, "http://api.envapp.test");
  });

  it("uses hostnameBase override and https in production", () => {
    const config: yarderConfig = {
      name: "basic",
      services: {
        api: { command: "node dist/index.js", dir: ".", port: 4000, dev: "npx tsx watch src/index.ts" },
      },
    };
    const local = resolveProject(config, tmp, { envName: "local" });
    const apiLocal = local.services.api;
    assert.equal(apiLocal.kind, "process");
    if (apiLocal.kind !== "process") return;
    assert.match(apiLocal.command, /tsx watch/);
    assert.equal(apiLocal.url, "http://api.basic.test");

    const prod = resolveProject(config, tmp, {
      envName: "production",
      hostnameBase: "example.com",
      urlScheme: "https",
    });
    const apiProd = prod.services.api;
    assert.equal(apiProd.kind, "process");
    if (apiProd.kind !== "process") return;
    assert.equal(prod.hostnameBase, "example.com");
    assert.equal(apiProd.hostname, "api.example.com");
    assert.equal(apiProd.url, "https://api.example.com");
    assert.equal(apiProd.command, "node dist/index.js");
    assert.equal(apiProd.env.API_URL, "https://api.example.com");
  });

  it("makes yaml port win over a Next start script", () => {
    const appDir = path.join(tmp, "dashboard");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev --turbopack -p 3001" } }),
    );
    const project = resolveProject(
      {
        name: "holectus",
        services: {
          dashboard: { command: "pnpm run dev", dir: "./dashboard", port: 4000 },
        },
      },
      tmp,
    );
    const dashboard = project.services.dashboard;
    assert.equal(dashboard.kind, "process");
    if (dashboard.kind !== "process") return;
    assert.equal(dashboard.command, "next dev --turbopack -p 4000");
    assert.equal(dashboard.env.PORT, "4000");
  });
});
