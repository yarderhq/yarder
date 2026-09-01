import pm2 from "pm2";
import { matchesyarderProcess } from "./pm2.ts";
import { getProjectOrNull } from "./state.ts";

export type LogLine = {
  ts: string;
  service: string;
  stream: "stdout" | "stderr";
  line: string;
};

type Subscriber = (entry: LogLine) => void;

const buffer: LogLine[] = [];
const subscribers = new Set<Subscriber>();
const MAX_BUFFER = 500;
let busStarted = false;

export function recentLogs(service?: string, limit = 200): LogLine[] {
  const filtered = service && service !== "all"
    ? buffer.filter((entry) => entry.service === service)
    : buffer;
  return filtered.slice(-limit);
}

export function subscribeLogs(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function emit(entry: LogLine): void {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  for (const subscriber of subscribers) {
    subscriber(entry);
  }
}

export function emitSystemLog(service: string, line: string): void {
  emit({
    ts: new Date().toISOString(),
    service,
    stream: "stdout",
    line,
  });
}

export async function startLogBus(): Promise<void> {
  if (busStarted) return;
  busStarted = true;
  await new Promise<void>((resolve, reject) => {
    pm2.launchBus((err, bus) => {
      if (err) {
        reject(err);
        return;
      }
      bus.on("log:out", (packet: { process?: { name?: string }; data?: string }) => {
        forward("stdout", packet);
      });
      bus.on("log:err", (packet: { process?: { name?: string }; data?: string }) => {
        forward("stderr", packet);
      });
      resolve();
    });
  });
}

function forward(stream: "stdout" | "stderr", packet: { process?: { name?: string }; data?: string }): void {
  const project = getProjectOrNull();
  if (!project) return;
  const service = matchesyarderProcess(project.config.name, packet.process?.name);
  if (!service) return;
  const text = String(packet.data ?? "");
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    emit({
      ts: new Date().toISOString(),
      service,
      stream,
      line,
    });
  }
}
