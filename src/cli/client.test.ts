import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAgentFailure } from "./client.ts";

describe("formatAgentFailure", () => {
  it("prints crash logs under the error header", () => {
    const message = formatAgentFailure(
      {
        error: "api did not become healthy (status: stopped).",
        logs: ["Cannot find module './dist/index.js'"],
      },
      500,
      "POST",
      "/api/dev/start",
    );
    assert.equal(
      message,
      "api did not become healthy (status: stopped).\n\nCannot find module './dist/index.js'",
    );
  });
});
