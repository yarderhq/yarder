import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAppService, isPostgresService, isRedisService, yarderConfigSchema } from "./schema.ts";

describe("yarderConfigSchema", () => {
  it("parses process, postgres, redis, and health", () => {
    const config = yarderConfigSchema.parse({
      name: "demo",
      services: {
        web: { command: "npm run dev", dir: "./web", port: 3000, health: "/health" },
        postgres: { type: "postgres", port: 55432 },
        redis: { type: "redis" },
      },
    });
    assert.equal(config.name, "demo");
    assert.equal(isAppService(config.services.web), true);
    assert.equal(isPostgresService(config.services.postgres), true);
    assert.equal(isRedisService(config.services.redis), true);
    if (isAppService(config.services.web)) {
      assert.equal(config.services.web.health, "/health");
      assert.equal(config.services.web.port, 3000);
    }
  });

  it("parses install, build, and dev overrides", () => {
    const config = yarderConfigSchema.parse({
      name: "demo",
      services: {
        web: {
          command: "node dist/index.js",
          dir: "./web",
          install: "npm ci",
          build: "npm run build",
          dev: "npm run dev",
        },
      },
    });
    const web = config.services.web;
    assert.equal(isAppService(web), true);
    if (!isAppService(web)) return;
    assert.equal(web.install, "npm ci");
    assert.equal(web.build, "npm run build");
    assert.equal(web.dev, "npm run dev");
    assert.equal(web.command, "node dist/index.js");
  });

  it("rejects an empty process command", () => {
    const result = yarderConfigSchema.safeParse({
      name: "demo",
      services: { web: { command: "" } },
    });
    assert.equal(result.success, false);
  });
});
