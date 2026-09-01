import assert from "node:assert/strict";
import Fastify from "fastify";
import { after, describe, it } from "node:test";
import { extractToken, registerAuth } from "./auth.ts";

describe("registerAuth", () => {
  const previous = process.env.YARDER_AGENT_TOKEN;
  after(() => {
    if (previous === undefined) delete process.env.YARDER_AGENT_TOKEN;
    else process.env.YARDER_AGENT_TOKEN = previous;
  });

  it("allows unauthenticated access when no token is configured", async () => {
    delete process.env.YARDER_AGENT_TOKEN;
    const app = Fastify();
    registerAuth(app);
    app.get("/api/status", async () => ({ ok: true }));
    const res = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  it("rejects missing tokens and accepts bearer or query tokens", async () => {
    process.env.YARDER_AGENT_TOKEN = "secret-token";
    const app = Fastify();
    registerAuth(app);
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/api/status", async () => ({ ok: true }));

    const denied = await app.inject({ method: "GET", url: "/api/status" });
    assert.equal(denied.statusCode, 401);

    const health = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(health.statusCode, 200);

    const bearer = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { authorization: "Bearer secret-token" },
    });
    assert.equal(bearer.statusCode, 200);

    const query = await app.inject({ method: "GET", url: "/api/status?token=secret-token" });
    assert.equal(query.statusCode, 200);

    await app.close();
  });
});

describe("extractToken", () => {
  it("reads bearer, custom header, and query", () => {
    assert.equal(
      extractToken({
        headers: { authorization: "Bearer abc" },
        query: {},
        url: "/api/status",
      } as never),
      "abc",
    );
    assert.equal(
      extractToken({
        headers: { "x-yarder-token": "from-header" },
        query: {},
        url: "/api/status",
      } as never),
      "from-header",
    );
    assert.equal(
      extractToken({
        headers: {},
        query: { token: "from-query" },
        url: "/ws/logs?token=from-query",
      } as never),
      "from-query",
    );
  });
});
