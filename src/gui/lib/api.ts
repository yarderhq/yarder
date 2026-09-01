export type EnvVarView = {
  value: string;
  source: "dotenv" | "yaml" | "injected";
};

export type ServiceView = {
  name: string;
  kind: "process" | "postgres" | "redis";
  status: string;
  health: "healthy" | "starting" | "unhealthy" | "stopped";
  port?: number;
  hostname?: string;
  url?: string;
  command?: string;
  memory?: number;
  cpu?: number;
  env: Record<string, EnvVarView>;
};

export type TlsView = {
  status: "active" | "skipped" | "error" | "none";
  message?: string;
  expiry?: string;
  hosts: string[];
};

export type ProjectPayload = {
  name: string;
  root: string;
  hostnameBase: string;
  env?: string;
  tls?: TlsView;
  services: ServiceView[];
  platform: {
    nativeWindows: boolean;
    hostnameRouting: boolean;
  };
};

export type EnvironmentInfo = {
  name: string;
  kind: "local" | "remote";
  url: string;
  token?: string;
  domain?: string;
  reachable?: boolean;
};

export type LogLine = {
  ts: string;
  service: string;
  stream: "stdout" | "stderr";
  line: string;
};

type ApiTarget = {
  baseUrl: string;
  token?: string;
};

let target: ApiTarget = { baseUrl: "" };

export function setApiTarget(next: ApiTarget): void {
  target = { baseUrl: next.baseUrl.replace(/\/$/, ""), token: next.token };
}

export function currentApiTarget(): ApiTarget {
  return target;
}

function resolveUrl(pathname: string): string {
  if (!target.baseUrl) return pathname;
  return `${target.baseUrl}${pathname}`;
}

async function request<T>(method: string, pathname: string, body?: unknown, opts?: { local?: boolean }): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/json";
  if (!opts?.local && target.token) headers.authorization = `Bearer ${target.token}`;
  const url = opts?.local ? pathname : resolveUrl(pathname);
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `${method} ${pathname} failed`);
  }
  return data;
}

export function logsSocketUrl(): string {
  const origin = target.baseUrl || window.location.origin;
  const url = new URL(origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/logs";
  url.search = "";
  if (target.token) url.searchParams.set("token", target.token);
  return url.toString();
}

export const api = {
  project: () => request<ProjectPayload>("GET", "/api/project"),
  startAll: () => request<{ services: ServiceView[] }>("POST", "/api/dev/start"),
  stopAll: () => request<{ services: ServiceView[] }>("POST", "/api/dev/stop"),
  startOne: (name: string) => request<{ services: ServiceView[] }>("POST", `/api/services/${name}/start`),
  stopOne: (name: string) => request<{ services: ServiceView[] }>("POST", `/api/services/${name}/stop`),
  restartOne: (name: string) => request<{ services: ServiceView[] }>("POST", `/api/services/${name}/restart`),
  environments: () =>
    request<{ current: string; environments: EnvironmentInfo[] }>("GET", "/api/environments", undefined, { local: true }),
  upEnvironment: (name: string) =>
    request<{ ok: boolean; url: string; token?: string; domain?: string }>(
      "POST",
      `/api/environments/${encodeURIComponent(name)}/up`,
      undefined,
      { local: true },
    ),
};
