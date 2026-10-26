import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: false,
    defaultErrorComponent: () => (
      <main className="fatal-error">
        <h1>Something interrupted the reader.</h1>
        <p>No recordings have been changed.</p>
        <a href="/">Return to recordings</a>
      </main>
    ),
    defaultNotFoundComponent: () => (
      <main className="fatal-error">
        <h1>Page not found.</h1>
        <a href="/">Return to recordings</a>
      </main>
    ),
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
