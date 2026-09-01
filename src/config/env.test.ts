import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeServiceEnv, parseEnvFile, redactEnv } from "./env.ts";

describe("parseEnvFile", () => {
  it("parses keys, comments, export, and quotes", () => {
    const parsed = parseEnvFile(`
# comment
SECRET=from-dotenv
export TOKEN=abc
QUOTED="hello world"
SINGLE='x=y'
NOT A LINE
`);
    assert.equal(parsed.SECRET, "from-dotenv");
    assert.equal(parsed.TOKEN, "abc");
    assert.equal(parsed.QUOTED, "hello world");
    assert.equal(parsed.SINGLE, "x=y");
    assert.equal(parsed.EMPTY, undefined);
  });
});

describe("mergeServiceEnv", () => {
  it("applies dotenv, then yaml, then injected", () => {
    const { env, sources } = mergeServiceEnv({
      dotenv: { SECRET: "dotenv", SHARED: "dotenv", DATABASE_URL: "dotenv-db" },
      yaml: { SHARED: "yaml", FEATURE: "on" },
      injected: { DATABASE_URL: "postgres://injected", PORT: "4007" },
    });
    assert.equal(env.SECRET, "dotenv");
    assert.equal(env.SHARED, "yaml");
    assert.equal(env.FEATURE, "on");
    assert.equal(env.DATABASE_URL, "postgres://injected");
    assert.equal(env.PORT, "4007");
    assert.equal(sources.SECRET, "dotenv");
    assert.equal(sources.SHARED, "yaml");
    assert.equal(sources.FEATURE, "yaml");
    assert.equal(sources.DATABASE_URL, "injected");
    assert.equal(sources.PORT, "injected");
  });
});

describe("redactEnv", () => {
  it("shows injected values and masks everything else", () => {
    const view = redactEnv(
      { DATABASE_URL: "postgres://local", SECRET: "shh", PORT: "4007", io: "pm2-internal" },
      { DATABASE_URL: "injected", SECRET: "dotenv", PORT: "injected" },
    );
    assert.equal(view.DATABASE_URL.value, "postgres://local");
    assert.equal(view.SECRET.value, "***");
    assert.equal(view.PORT.value, "4007");
    assert.equal(view.io, undefined);
  });
});
