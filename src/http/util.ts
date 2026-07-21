import type { Context } from "hono";
import { badRequest } from "../services/errors";
import type { AppEnv } from "./types";

/** Parse a JSON object body or throw a 400. */
export async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw badRequest("invalid_json", "Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("invalid_body", "Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw badRequest("missing_field", `"${key}" is required`);
  }
  return v;
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw badRequest("bad_field", `"${key}" must be a string`);
  return v;
}

export function optionalInt(body: Record<string, unknown>, key: string): number | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw badRequest("bad_field", `"${key}" must be an integer`);
  }
  return v;
}

export function requireInt(body: Record<string, unknown>, key: string): number {
  const v = optionalInt(body, key);
  if (v === undefined) throw badRequest("missing_field", `"${key}" is required`);
  return v;
}

/** Read a required path param (narrows away `undefined`). */
export function requireParam(c: Context<AppEnv>, key: string): string {
  const v = c.req.param(key);
  if (!v) throw badRequest("missing_param", `path param "${key}" is required`);
  return v;
}
