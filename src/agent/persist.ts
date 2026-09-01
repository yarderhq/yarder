import fs from "node:fs";
import path from "node:path";
import { yarderHome, type yarderEnvName } from "../config/constants.ts";
import { findConfigFile, loadConfig, projectRootFromConfig } from "../config/load.ts";
import { resolveProject, type UrlScheme } from "../config/resolve.ts";
import { setProject, type LoadedProject } from "./state.ts";

export type AgentStateFile = {
  root: string;
  hostnameBase?: string;
  urlScheme?: UrlScheme;
  envName?: yarderEnvName;
};

export function agentStatePath(): string {
  return process.env.YARDER_STATE_PATH ?? path.join(yarderHome(), "agent-state.json");
}

export function saveAgentState(state: AgentStateFile): void {
  const file = agentStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function loadAgentState(): AgentStateFile | null {
  const file = agentStatePath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as AgentStateFile;
    if (!parsed.root) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function restoreProject(): LoadedProject | null {
  const state = loadAgentState();
  const root = process.env.YARDER_PROJECT_ROOT?.trim() || state?.root;
  if (!root) return null;
  const configPath = findConfigFile(root);
  if (!configPath) return null;
  const config = loadConfig(configPath);
  const projectRoot = projectRootFromConfig(configPath);
  const resolved = resolveProject(config, projectRoot, {
    hostnameBase: state?.hostnameBase,
    urlScheme: state?.urlScheme,
    envName: state?.envName,
  });
  return setProject({ root: projectRoot, configPath, config, resolved });
}
