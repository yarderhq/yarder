import { AGENT_HOST, AGENT_PORT, agentBaseUrl } from "../config/constants.ts";

export type AgentClientOptions = {
  baseUrl?: string;
  token?: string;
};

export class AgentClient {
  readonly baseUrl: string;
  readonly token?: string;

  constructor(opts: AgentClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? agentBaseUrl()).replace(/\/$/, "");
    this.token = opts.token;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { headers: this.headers(false) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: this.headers(Boolean(body)),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: T & { error?: string; logs?: string[] };
    try {
      data = JSON.parse(text) as T & { error?: string; logs?: string[] };
    } catch {
      throw new Error(`${method} ${pathname} failed (${res.status}): ${text.slice(0, 200) || "empty response"}`);
    }
    if (!res.ok) {
      throw new Error(formatAgentFailure(data, res.status, method, pathname));
    }
    return data;
  }

  wsLogs(): WebSocket {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/logs";
    url.search = "";
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    return new WebSocket(url);
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return headers;
  }
}

export function formatAgentFailure(
  data: { error?: string; logs?: string[] },
  status: number,
  method: string,
  pathname: string,
): string {
  const header = data.error || `${method} ${pathname} failed (${status})`;
  const logs = data.logs?.filter((line) => line.trim()) ?? [];
  if (logs.length === 0) return header;
  return `${header}\n\n${logs.join("\n")}`;
}

export function localAgentClient(token?: string): AgentClient {
  return new AgentClient({ baseUrl: agentBaseUrl(AGENT_PORT, AGENT_HOST), token });
}
