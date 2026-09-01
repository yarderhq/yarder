export type CheckStatus = "ok" | "missing" | "action";

export type CheckId = "wsl" | "node" | "nginx" | "postgres" | "redis";

export type RepairKind =
  | "install-wsl"
  | "install-ubuntu"
  | "set-wsl-version"
  | "provision-wsl"
  | "apt-packages"
  | "brew-packages"
  | "install-node-apt"
  | "install-node-nvm";

export type SetupCheck = {
  id: CheckId;
  label: string;
  status: CheckStatus;
  detail: string;
  repair?: RepairKind;
};

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inheritStdio?: boolean;
};

export type RunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type Runner = (command: string, args?: string[], opts?: RunOptions) => RunResult;

export type SetupContext = {
  platform: NodeJS.Platform;
  isWsl: boolean;
  isNativeWindows: boolean;
  nodeVersion: string;
  env: NodeJS.ProcessEnv;
  run: Runner;
  which: (bin: string) => string | null;
  hasPostgres: () => boolean;
  hasRedis: () => boolean;
  hasDebian: boolean;
  hasHomebrew: boolean;
  packageRoot: string;
  cwd: string;
  log: (msg: string) => void;
};

export type ApplyOutcome = {
  repairs: RepairKind[];
  reboot?: boolean;
  failed?: boolean;
  message?: string;
};
