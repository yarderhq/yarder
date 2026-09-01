import type { FastifyInstance, FastifyRequest } from "fastify";
import { agentToken } from "../config/constants.ts";

export function extractToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const value = header.slice("Bearer ".length).trim();
    if (value) return value;
  }
  const custom = req.headers["x-yarder-token"];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  const query = req.query as { token?: unknown };
  if (typeof query?.token === "string" && query.token.trim()) return query.token.trim();
  return undefined;
}

export function registerAuth(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    const expected = agentToken();
    if (!expected) return;
    const url = req.url ?? "";
    const pathname = url.split("?")[0] ?? url;
    if (pathname === "/api/health") return;
    if (!pathname.startsWith("/api") && !pathname.startsWith("/ws")) return;
    if (extractToken(req) !== expected) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
