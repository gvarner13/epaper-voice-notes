import {
  createStart,
  createMiddleware,
  createCsrfMiddleware,
} from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { isLocalRequest } from "./lib/local-request";

const localOnly = createMiddleware().server(({ request, next }) => {
  if (!isLocalRequest(request))
    return new Response("Local requests only", { status: 403 });
  setResponseHeader("Cache-Control", "no-store");
  setResponseHeader("Referrer-Policy", "no-referrer");
  setResponseHeader("X-Content-Type-Options", "nosniff");
  setResponseHeader("X-Frame-Options", "DENY");
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    localOnly,
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  ],
}));
