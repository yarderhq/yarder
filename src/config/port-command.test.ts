import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commandWithPort,
  detectListenKind,
  expandPackageScript,
  parsePackageManagerCommand,
  stripPortFlags,
} from "./port-command.ts";

describe("stripPortFlags", () => {
  it("removes -p, --port, and --port=", () => {
    assert.equal(stripPortFlags("next dev --turbopack -p 3001"), "next dev --turbopack");
    assert.equal(stripPortFlags("vite --port 5173"), "vite");
    assert.equal(stripPortFlags("astro dev --port=3004"), "astro dev");
  });
});

describe("parsePackageManagerCommand", () => {
  it("parses run scripts and extra args", () => {
    assert.deepEqual(parsePackageManagerCommand("pnpm run dev"), {
      agent: "pnpm",
      script: "dev",
      extra: "",
    });
    assert.deepEqual(parsePackageManagerCommand("npm start"), {
      agent: "npm",
      script: "start",
      extra: "",
    });
    assert.deepEqual(parsePackageManagerCommand("pnpm --filter @holectus/dashboard run dev"), {
      agent: "pnpm",
      script: "dev",
      extra: "",
    });
    assert.deepEqual(parsePackageManagerCommand("pnpm run dev -- --turbo"), {
      agent: "pnpm",
      script: "dev",
      extra: "--turbo",
    });
  });
});

describe("commandWithPort", () => {
  it("rewrites a Next script so yaml port wins", () => {
    const command = commandWithPort("pnpm run dev", 4000, {
      pkg: { scripts: { dev: "next dev --turbopack -p 3001" } },
    });
    assert.equal(command, "next dev --turbopack -p 4000");
  });

  it("rewrites Vite and Astro to --port", () => {
    assert.equal(
      commandWithPort("pnpm run dev", 4000, { pkg: { scripts: { dev: "vite --port 5173" } } }),
      "vite --port 4000",
    );
    assert.equal(
      commandWithPort("pnpm run dev", 3004, { pkg: { scripts: { dev: "astro dev --port 3004" } } }),
      "astro dev --port 3004",
    );
  });

  it("leaves Node commands unchanged", () => {
    assert.equal(
      commandWithPort("pnpm run start", 3000, {
        pkg: { scripts: { start: "node ./dist/index.js" }, dependencies: { next: "16.0.0" } },
      }),
      "pnpm run start",
    );
    assert.equal(commandWithPort("node index.js", 4007), "node index.js");
  });

  it("keeps extra script args while replacing the port", () => {
    assert.equal(
      commandWithPort("pnpm run dev -- --turbo", 4000, {
        pkg: { scripts: { dev: "next dev -p 3001" } },
      }),
      "next dev --turbo -p 4000",
    );
  });

  it("appends a flag when the script cannot be expanded but Next is a dependency", () => {
    assert.equal(
      commandWithPort("pnpm run dev", 4000, { pkg: { dependencies: { next: "16.0.0" } } }),
      "pnpm run dev -- -p 4000",
    );
  });

  it("returns the original command when port is omitted", () => {
    assert.equal(commandWithPort("next dev -p 3001", undefined), "next dev -p 3001");
  });
});

describe("detectListenKind", () => {
  it("prefers Next over Vite", () => {
    assert.equal(detectListenKind("next dev --turbopack"), "next");
    assert.equal(detectListenKind("vite"), "vite");
  });
});

describe("expandPackageScript", () => {
  it("joins extra args onto the script body", () => {
    assert.equal(
      expandPackageScript("pnpm run dev -- --turbo", { scripts: { dev: "next dev" } }),
      "next dev --turbo",
    );
  });
});
