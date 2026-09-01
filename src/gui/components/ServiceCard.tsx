import type { ServiceView } from "../lib/api.ts";
import { Database, RotateCw, Square, Play } from "lucide-react";

const healthClass: Record<ServiceView["health"], string> = {
  healthy: "bg-emerald-400",
  starting: "bg-amber-400",
  unhealthy: "bg-red-400",
  stopped: "bg-zinc-500",
};

export function ServiceCard({
  service,
  onStart,
  onStop,
  onRestart,
}: {
  service: ServiceView;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const online = service.status === "online";
  const managed = service.kind === "postgres" || service.kind === "redis";
  const localHref = service.port ? `http://127.0.0.1:${service.port}` : undefined;
  const envKeys = Object.entries(service.env ?? {});

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${healthClass[service.health]}`} />
            <h3 className="font-medium">{service.name}</h3>
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
              {service.health}
            </span>
          </div>
          <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{service.kind}</p>
        </div>
        <div className="flex gap-1">
          {online ? (
            <>
              <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800" onClick={onRestart} title="Restart">
                <RotateCw size={14} />
              </button>
              <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800" onClick={onStop} title="Stop">
                <Square size={14} />
              </button>
            </>
          ) : (
            <button className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800" onClick={onStart} title="Start">
              <Play size={14} />
            </button>
          )}
        </div>
      </div>
      <dl className="mt-3 space-y-1 font-mono text-xs text-zinc-400">
        {!managed && service.hostname && service.url && (
          <div>
            <a className="text-sky-400 hover:underline" href={service.url} target="_blank" rel="noreferrer">
              {service.hostname}
            </a>
          </div>
        )}
        {!managed && localHref && (
          <div>
            <a className="text-sky-400 hover:underline" href={localHref} target="_blank" rel="noreferrer">
              {localHref.replace("http://", "")}
            </a>
          </div>
        )}
        {managed && service.url && <div className="truncate">{service.url}</div>}
        {typeof service.memory === "number" && service.memory > 0 && (
          <div>{(service.memory / 1024 / 1024).toFixed(0)} MB</div>
        )}
        {managed && (
          <div className="flex items-center gap-1 text-zinc-500">
            <Database size={12} /> managed
          </div>
        )}
      </dl>
      {envKeys.length > 0 && (
        <ul className="mt-3 space-y-0.5 font-mono text-[11px] text-zinc-500">
          {envKeys.map(([key, entry]) => (
            <li key={key} className="truncate">
              {key}={entry.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
