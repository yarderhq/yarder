import { useEffect, useRef } from "react";
import type { LogLine } from "../lib/api.ts";

export function LogPane({ logs, filter, onFilter }: { logs: LogLine[]; filter: string; onFilter: (value: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight);
  }, [logs]);

  const services = ["all", ...Array.from(new Set(logs.map((log) => log.service)))];
  const visible = filter === "all" ? logs : logs.filter((log) => log.service === filter);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-zinc-800">
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-400">
        <span className="uppercase tracking-wider">Logs</span>
        {services.map((service) => (
          <button
            key={service}
            className={`rounded-md px-2 py-1 ${filter === service ? "bg-zinc-800 text-zinc-100" : "hover:bg-zinc-900"}`}
            onClick={() => onFilter(service)}
          >
            {service}
          </button>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-black/40 px-4 py-3 font-mono text-xs leading-5">
        {visible.length === 0 && <p className="text-zinc-500">No log lines yet.</p>}
        {visible.map((log, index) => (
          <div key={`${log.ts}-${index}`} className={log.stream === "stderr" ? "text-red-300" : "text-zinc-300"}>
            <span className="text-zinc-600">{log.ts.slice(11, 19)}</span>{" "}
            <span className="text-zinc-500">[{log.service}]</span> {log.line}
          </div>
        ))}
      </div>
    </section>
  );
}
