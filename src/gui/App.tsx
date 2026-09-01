import { useCallback, useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { LogPane } from "./components/LogPane.tsx";
import { ServiceCard } from "./components/ServiceCard.tsx";
import {
  api,
  logsSocketUrl,
  setApiTarget,
  type EnvironmentInfo,
  type LogLine,
  type ProjectPayload,
  type ServiceView,
} from "./lib/api.ts";

export function App() {
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState("all");
  const [envName, setEnvName] = useState("local");
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([
    { name: "local", kind: "local", url: window.location.origin, reachable: true },
  ]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.project();
      setProject(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.environments();
        if (data.environments.length > 0) setEnvironments(data.environments);
      } catch {
        // Local-only agent without remotes.
      }
    })();
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh, envName]);

  useEffect(() => {
    setLogs([]);
    const socket = new WebSocket(logsSocketUrl());
    socket.addEventListener("message", (event) => {
      const entry = JSON.parse(String(event.data)) as LogLine;
      setLogs((current) => [...current.slice(-400), entry]);
    });
    return () => socket.close();
  }, [envName]);

  async function selectEnv(name: string) {
    setError(null);
    try {
      if (name === "local") {
        setApiTarget({ baseUrl: "" });
        setEnvName("local");
        return;
      }
      const up = await api.upEnvironment(name);
      setApiTarget({ baseUrl: up.url, token: up.token });
      setEnvName(name);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not reach ${name}. Run yarder remote add and yarder deploy first.`,
      );
    }
  }

  async function run(action: () => Promise<{ services: ServiceView[] }>) {
    try {
      const result = await action();
      if (project) {
        setProject({ ...project, services: result.services });
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const tls = project?.tls;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{project?.name ?? "yarder"}</h1>
            <div className="flex rounded-full bg-zinc-900 p-0.5 text-xs uppercase tracking-wider">
              {environments.map((item) => (
                <button
                  key={item.name}
                  className={`rounded-full px-2 py-0.5 ${
                    envName === item.name ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                  onClick={() => void selectEnv(item.name)}
                >
                  {item.name === "local" ? "Local" : item.name}
                </button>
              ))}
              {environments.every((item) => item.name !== "production") && envName === "local" && (
                <span className="px-2 py-0.5 text-zinc-600" title="Add a remote with yarder remote add">
                  Production
                </span>
              )}
            </div>
            {tls?.status === "active" && (
              <span className="rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
                TLS{tls.expiry ? ` · ${tls.expiry}` : ""}
              </span>
            )}
          </div>
          {project && <p className="mt-1 font-mono text-xs text-zinc-500">{project.root}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500"
            onClick={() => void run(api.startAll)}
          >
            <Play size={14} /> Start all
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium hover:bg-zinc-700"
            onClick={() => void run(api.stopAll)}
          >
            <Square size={14} /> Stop all
          </button>
          <span className="ml-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">yarder</span>
        </div>
      </header>

      {error && <div className="border-b border-amber-900 bg-amber-950/40 px-6 py-2 text-sm text-amber-200">{error}</div>}
      {envName !== "local" && !project && error && (
        <div className="border-b border-zinc-800 px-6 py-2 text-sm text-zinc-400">
          Production is reached over SSH. Run `yarder remote add` then `yarder deploy` if this environment is empty.
        </div>
      )}
      {project && !project.platform.hostnameRouting && envName === "local" && (
        <div className="border-b border-zinc-800 px-6 py-2 text-sm text-zinc-400">
          Native Windows is not supported for hostname routing. Run `yarder setup` to install WSL2, then use yarder from
          Ubuntu. Services are still reachable on localhost ports.
        </div>
      )}
      {tls && tls.status !== "none" && tls.status !== "active" && tls.message && (
        <div className="border-b border-zinc-800 px-6 py-2 text-sm text-zinc-400">{tls.message}</div>
      )}

      <main className="grid flex-1 grid-rows-[auto_1fr] gap-0">
        <section className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3">
          {project?.services.map((service) => (
            <ServiceCard
              key={service.name}
              service={service}
              onStart={() => void run(() => api.startOne(service.name))}
              onStop={() => void run(() => api.stopOne(service.name))}
              onRestart={() => void run(() => api.restartOne(service.name))}
            />
          ))}
          {!project && <p className="text-sm text-zinc-500">Load a project with `yarder dev` or `yarder deploy`.</p>}
        </section>
        <LogPane logs={logs} filter={filter} onFilter={setFilter} />
      </main>
    </div>
  );
}
