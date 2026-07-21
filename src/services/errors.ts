import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Domain error carrying an HTTP status + stable machine code. The HTTP layer
 *  maps this to a JSON error response. */
export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "forbidden") => new ApiError(403, "forbidden", msg);
export const badRequest = (code: string, msg: string, detail?: unknown) =>
  new ApiError(400, code, msg, detail);
export const conflict = (code: string, msg: string) => new ApiError(409, code, msg);
export const unprocessable = (code: string, msg: string, detail?: unknown) =>
  new ApiError(422, code, msg, detail);
