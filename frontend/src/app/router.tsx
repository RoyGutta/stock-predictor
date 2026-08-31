import { useEffect, type AnchorHTMLAttributes, type ReactNode } from "react";

import { RouteContext, routeToHash, useHashRoute, useRoute, type Page } from "./routes";

export function RouteProvider({ children }: { children: ReactNode }) {
  const route = useHashRoute();

  // Moving between pages should read as a new page to assistive tech: reset
  // scroll and put focus on the main landmark, mirroring a full navigation.
  useEffect(() => {
    window.scrollTo(0, 0);
    const main = document.getElementById("main");
    if (main) {
      main.focus({ preventScroll: true });
    }
  }, [route.page]);

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: Page;
  param?: string | null;
  children: ReactNode;
}

/** An anchor that targets a route. Real <a>, so middle-click and copy work. */
export function Link({ to, param = null, children, ...rest }: LinkProps) {
  return (
    <a href={routeToHash(to, param)} {...rest}>
      {children}
    </a>
  );
}

interface NavLinkProps extends LinkProps {
  /** Marks the link current when its page matches, for styling and AT. */
  activeClassName?: string;
}

export function NavLink({
  to,
  param = null,
  className = "",
  activeClassName = "",
  children,
  ...rest
}: NavLinkProps) {
  const route = useRoute();
  const isActive = route.page === to;
  const classes = [className, isActive ? activeClassName : ""].filter(Boolean).join(" ");

  return (
    <a
      href={routeToHash(to, param)}
      className={classes || undefined}
      aria-current={isActive ? "page" : undefined}
      {...rest}
    >
      {children}
    </a>
  );
}
