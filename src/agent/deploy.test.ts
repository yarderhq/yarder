import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { defaultInstallCommand, installBuildExcludes } from "./deploy.ts";
import type { ResolvedProject } from "../config/resolve.ts";
import { tarExcludeArgs } from "../remote/sync.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yarder-deploy-"));
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("defaultInstallCommand", () => {
  it("returns npm ci when package-lock exists", () => {
    const dir = path.join(tmp, "locked");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    assert.equal(defaultInstallCommand(dir), "npm ci");
  });

  it("returns npm install when only package.json exists", () => {
    const dir = path.join(tmp, "unlocked");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    assert.equal(defaultInstallCommand(dir), "npm install");
  });

  it("returns undefined without package.json", () => {
    const dir = path.join(tmp, "empty");
    fs.mkdirSync(dir);
    assert.equal(defaultInstallCommand(dir), undefined);
  });
});

describe("sync excludes", () => {
  it("omits dist when a service has a build command", () => {
    const project: ResolvedProject = {
      name: "demo",
      hostnameBase: "example.com",
      urlScheme: "http",
      envName: "production",
      root: tmp,
      runtimeDir: path.join(tmp, ".yarder"),
      services: {
        web: {
          kind: "process",
          name: "web",
          command: "node dist/index.js",
          dir: tmp,
          env: {},
          envSources: {},
          dependsOn: [],
          build: "npm run build",
        },
      },
    };
    const excludes = installBuildExcludes(project);
    assert.deepEqual(excludes, ["node_modules", ".git", ".yarder/data", ".yarder/nginx", "dist"]);
    assert.deepEqual(tarExcludeArgs(excludes).slice(0, 2), ["--exclude", "node_modules"]);
  });
});
