import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSshTarget, parseSshTarget, shQuote } from "./ssh.ts";
import { remoteAppDir, type RemoteRecord } from "./remotes.ts";

describe("parseSshTarget", () => {
  it("parses user@host and optional port", () => {
    assert.deepEqual(parseSshTarget("deploy@203.0.113.10"), { user: "deploy", host: "203.0.113.10", port: undefined });
    assert.deepEqual(parseSshTarget("deploy@example.com:2222"), { user: "deploy", host: "example.com", port: 2222 });
    assert.deepEqual(parseSshTarget("deploy@example.com", 2200), { user: "deploy", host: "example.com", port: 2200 });
    assert.equal(formatSshTarget({ user: "deploy", host: "example.com", port: 2222 }), "deploy@example.com:2222");
  });

  it("rejects targets without user@host", () => {
    assert.throws(() => parseSshTarget("only-host"), /Invalid SSH target/);
  });
});

describe("shQuote", () => {
  it("wraps for POSIX shells", () => {
    assert.equal(shQuote("hello"), "'hello'");
    assert.equal(shQuote("it's"), `'it'\\''s'`);
  });
});

describe("remoteAppDir", () => {
  it("nests the project slug under the remote apps dir", () => {
    const remote: RemoteRecord = {
      ssh: "deploy@host",
      dir: "/var/yarder/apps",
      token: "x",
      agentPort: 3847,
      localTunnelPort: 13847,
    };
    assert.equal(remoteAppDir(remote, "My App"), "/var/yarder/apps/my-app");
  });
});
