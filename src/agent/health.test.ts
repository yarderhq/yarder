import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnhealthyServiceError, formatUnhealthyError, startFailurePayload } from "./health.ts";

describe("formatUnhealthyError", () => {
  it("includes status and process logs", () => {
    const message = formatUnhealthyError("api", "stopped", ["Cannot find module './dist/index.js'"]);
    assert.match(message, /api did not become healthy \(status: stopped\)/);
    assert.match(message, /Cannot find module '\.\/dist\/index\.js'/);
  });

  it("notes when no logs were captured", () => {
    const message = formatUnhealthyError("api", "errored", []);
    assert.match(message, /No process logs were captured/);
  });
});

describe("startFailurePayload", () => {
  it("splits unhealthy errors into a short header and log lines", () => {
    const payload = startFailurePayload(
      new UnhealthyServiceError("api", "stopped", ["Cannot find module './dist/index.js'"]),
    );
    assert.equal(payload.error, "api did not become healthy (status: stopped).");
    assert.deepEqual(payload.logs, ["Cannot find module './dist/index.js'"]);
  });
});
