import { createHash } from "node:crypto";
import { API_OPERATIONS, portableContract } from "@/lib/api/contracts";
import { authenticateApiKey, type ApiKeyInfo } from "@/lib/api/keys";
import { readBoundedJson } from "@/lib/api/security";

type Context = {
  params: Promise<Record<string, string>>;
  body: unknown;
  query: Record<string, unknown>;
  key: ApiKeyInfo | null;
};
const contractHash = createHash("sha256")
  .update(JSON.stringify(portableContract()))
  .digest("hex");
export function apiOperation(
  id: string,
  handler: (request: Request, context: Context) => Response | Promise<Response>,
) {
  const op = API_OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`Unregistered API operation: ${id}`);
  return async (
    request: Request,
    context?: { params: Promise<Record<string, string>> },
  ) => {
    const run = async () => {
      const clientContract = request.headers.get("X-Mail-Digester-Contract");
      if (clientContract && clientContract !== contractHash)
        return Response.json(
          {
            error:
              "Server/CLI API contracts differ. Update the client and server before retrying.",
            code: "API_CONTRACT_MISMATCH",
          },
          { status: 409 },
        );
      let key: ApiKeyInfo | null = null;
      if (
        id !== "health" &&
        (!op.browser ||
          request.headers.get("authorization")?.startsWith("Bearer"))
      ) {
        const auth = authenticateApiKey(request, op.scope);
        if ("denied" in auth) return auth.denied;
        key = auth.key;
      }
      let body: unknown;
      let query: Record<string, unknown> = {};
      const params = await (context?.params ?? Promise.resolve({}));
      try {
        if (op.params) op.params.parse(params);
        if (op.query)
          query = op.query.parse(
            Object.fromEntries(new URL(request.url).searchParams),
          ) as Record<string, unknown>;
        if (op.body)
          body = op.body.parse(
            request.body
              ? await readBoundedJson(
                  request,
                  id === "ingest" ? 512_000 : 2048,
                  op.body.safeParse(undefined).success,
                )
              : undefined,
          );
      } catch (error) {
        return Response.json(
          {
            error: "Invalid request",
            issues:
              error instanceof Error && "issues" in error
                ? error.issues
                : undefined,
          },
          { status: 400 },
        );
      }
      return handler(request, {
        params: Promise.resolve(params),
        body,
        query,
        key,
      });
    };
    const response = await run();
    response.headers.set("X-Mail-Digester-Contract", contractHash);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
}
