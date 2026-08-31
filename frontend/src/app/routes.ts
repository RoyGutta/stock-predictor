import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Hash-based routing, deliberately dependency-free.
 *
 * Hash URLs work on any static host with zero server configuration, survive
 * refresh and deep-linking, and drive the browser's back/forward buttons for
 * free. The entire surface is: parse the hash, subscribe to changes, render
 * links (components live in router.tsx).
 */

export type Page =
  | "dashboard"
  | "analyze"
  | "explore"
  | "compare"
  | "portfolio"
  | "learn";

export interface Route {
  page: Page;
  /** Optional path parameter, e.g. the ticker in #/analyze/AAPL. */
  param: string | null;
}

export const DEFAULT_ROUTE: Route = { page: "dashboard", param: null };

const PAGES: ReadonlySet<string> = new Set([
  "dashboard",
  "analyze",
  "explore",
  "compare",
  "portfolio",
  "learn",
]);

/**
 * Parse a location hash into a route.
 *
 * Unknown pages fall back to the dashboard rather than a dead end: a stale
 * bookmark should degrade to something useful. The parameter segment is
 * decoded but otherwise left to the consuming page to validate — the router
 * has no opinion about what a valid ticker is.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!path) return DEFAULT_ROUTE;

  const [head, ...rest] = path.split("/");
  const page = head.toLowerCase();
  if (!PAGES.has(page)) return DEFAULT_ROUTE;

  const param = rest.length > 0 ? decodeURIComponent(rest.join("/")).trim() : null;
  return { page: page as Page, param: param || null };
}

export function routeToHash(page: Page, param?: string | null): string {
  return param ? `#/${page}/${encodeURIComponent(param)}` : `#/${page}`;
}

export function navigate(page: Page, param?: string | null): void {
  window.location.hash = routeToHash(page, param);
}

function currentRoute(): Route {
  return parseHash(window.location.hash);
}

/** Subscribe to the current route. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

export const RouteContext = createContext<Route>(DEFAULT_ROUTE);

export function useRoute(): Route {
  return useContext(RouteContext);
}

/** Convenience for pages that navigate programmatically after an action. */
export function useNavigate(): (page: Page, param?: string | null) => void {
  return useCallback((page: Page, param?: string | null) => navigate(page, param), []);
}
