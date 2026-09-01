import { AGENT_PORT } from "../config/constants.ts";
import { listenAgent } from "./app.ts";

export async function startAgentProcess(port = AGENT_PORT) {
  const app = await listenAgent(port);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`.replaceAll("\\", "/")) {
  await startAgentProcess();
}
