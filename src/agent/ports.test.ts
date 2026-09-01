import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import type { ResolvedProject } from "../config/resolve.ts";
import { assertNoDuplicatePorts, isPortInUse } from "./ports.ts";

function project(services: ResolvedProject["services"]): ResolvedProject {
  return {
    name: "demo",
    hostnameBase: "demo.test",
    urlScheme: "http",
    envName: "local",
    root: ".",
    runtimeDir: ".yarder",
    services,
  };
}

describe("assertNoDuplicatePorts", () => {
  it("allows unique ports", () => {
    assert.doesNotThrow(() =>
      assertNoDuplicatePorts(
        project({
          web: {
            kind: "process",
            name: "web",
            command: "node",
            dir: ".",
            port: 3000,
            env: {},
            envSources: {},
            dependsOn: [],
          },
          api: {
            kind: "process",
            name: "api",
            command: "node",
            dir: ".",
            port: 4000,
            env: {},
            envSources: {},
            dependsOn: [],
          },
        }),
      ),
    );
  });

  it("fails when two services share a port", () => {
    assert.throws(
      () =>
        assertNoDuplicatePorts(
          project({
            web: {
              kind: "process",
              name: "web",
              command: "node",
              dir: ".",
              port: 4007,
              env: {},
              envSources: {},
              dependsOn: [],
            },
            api: {
              kind: "process",
              name: "api",
              command: "node",
              dir: ".",
              port: 4007,
              env: {},
              envSources: {},
              dependsOn: [],
            },
          }),
        ),
      /api port 4007 is already used by web|web port 4007 is already used by api/,
    );
  });
});

describe("isPortInUse", () => {
  it("detects a bound port", async () => {
    const server = net.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no port"));
      });
    });
    try {
      assert.equal(await isPortInUse(port), true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
    assert.equal(await isPortInUse(port), false);
  });
});
