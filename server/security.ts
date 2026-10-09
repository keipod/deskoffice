import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertSafeBinding(host: string, password?: string): void {
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && !password?.trim()) {
    throw new Error("DESKOFFICE_BASIC_PASSWORD must be set when binding a non-loopback host");
  }
}

export function isAuthorized(header: string | undefined, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const token = header.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token) || token.length > 4096) return false;
  try {
    const credential = Buffer.from(token, "base64").toString("utf8");
    const colon = credential.indexOf(":");
    return colon >= 0 && sameSecret(credential.slice(0, colon), "admin") &&
      sameSecret(credential.slice(colon + 1), password);
  } catch { return false; }
}

export function originMatchesHost(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // Non-browser API clients may omit Origin; authentication still applies.
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function authenticateRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const password = process.env.DESKOFFICE_BASIC_PASSWORD;
  if (password && !isAuthorized(request.headers.authorization, password)) {
    reply.header("WWW-Authenticate", 'Basic realm="DeskOffice"');
    return reply.code(401).send({ error: "authentication_required" });
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !originMatchesHost(request.headers.origin, request.headers.host)) {
    return reply.code(403).send({ error: "cross_origin_mutation_forbidden" });
  }
}
