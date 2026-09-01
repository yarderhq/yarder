import { z } from "zod";

export const AppServiceSchema = z.object({
  type: z.literal("process").optional(),
  command: z.string().min(1),
  dir: z.string().default("."),
  port: z.number().int().positive().optional(),
  health: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  install: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
  dev: z.string().min(1).optional(),
});

export const PostgresServiceSchema = z.object({
  type: z.literal("postgres"),
  port: z.number().int().positive().optional(),
  database: z.string().min(1).optional(),
});

export const RedisServiceSchema = z.object({
  type: z.literal("redis"),
  port: z.number().int().positive().optional(),
});

export const ServiceSchema = z.union([PostgresServiceSchema, RedisServiceSchema, AppServiceSchema]);

export const yarderConfigSchema = z.object({
  name: z.string().min(1),
  hostname: z.string().min(1).optional(),
  services: z.record(z.string(), z.unknown()).transform((services, ctx) => {
    const parsed: Record<string, Service> = {};
    for (const [name, value] of Object.entries(services)) {
      const result = parseService(value);
      if (!result.ok) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid service "${name}": ${result.error}`,
          path: [name],
        });
        continue;
      }
      parsed[name] = result.service;
    }
    return parsed;
  }),
});

export type AppService = z.infer<typeof AppServiceSchema>;
export type PostgresService = z.infer<typeof PostgresServiceSchema>;
export type RedisService = z.infer<typeof RedisServiceSchema>;
export type Service = AppService | PostgresService | RedisService;
export type yarderConfig = {
  name: string;
  hostname?: string;
  services: Record<string, Service>;
};

export function isPostgresService(service: Service): service is PostgresService {
  return "type" in service && service.type === "postgres";
}

export function isRedisService(service: Service): service is RedisService {
  return "type" in service && service.type === "redis";
}

export function isAppService(service: Service): service is AppService {
  return !isPostgresService(service) && !isRedisService(service);
}

function parseService(value: unknown): { ok: true; service: Service } | { ok: false; error: string } {
  const type = value && typeof value === "object" && "type" in value ? (value as { type?: string }).type : undefined;
  if (type === "postgres") {
    const result = PostgresServiceSchema.safeParse(value);
    return result.success
      ? { ok: true, service: result.data }
      : { ok: false, error: result.error.issues.map((issue) => issue.message).join("; ") };
  }
  if (type === "redis") {
    const result = RedisServiceSchema.safeParse(value);
    return result.success
      ? { ok: true, service: result.data }
      : { ok: false, error: result.error.issues.map((issue) => issue.message).join("; ") };
  }
  const result = AppServiceSchema.safeParse(value);
  return result.success
    ? { ok: true, service: result.data }
    : { ok: false, error: result.error.issues.map((issue) => issue.message).join("; ") };
}
