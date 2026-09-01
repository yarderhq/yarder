import type { yarderConfig } from "../config/schema.ts";
import type { ResolvedProject } from "../config/resolve.ts";

export type LoadedProject = {
  root: string;
  configPath: string;
  config: yarderConfig;
  resolved: ResolvedProject;
};

let loaded: LoadedProject | null = null;

export function getProject(): LoadedProject {
  if (!loaded) {
    throw new Error("No project loaded. Run yarder dev from a directory with yarder.yaml.");
  }
  return loaded;
}

export function getProjectOrNull(): LoadedProject | null {
  return loaded;
}

export function setProject(project: LoadedProject): LoadedProject {
  loaded = project;
  return loaded;
}
