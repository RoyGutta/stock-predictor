import { useEffect, useRef, useState } from "react";

import { ApiError, isAbort } from "../../lib/api";

export interface SecState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** HTTP status of the failure, so a 404 can offer a name search. */
  status: number | null;
}

const IDLE = { data: null, loading: false, error: null, status: null };

/**
 * Load one SEC resource per key; a null key leaves the hook idle.
 *
 * Kept separate from the market hooks because SEC panels need the failure
 * status, not only its message: "no SEC filer under this ticker" leads to a
 * company-name search, while "SEC unreachable" does not.
 */
export function useSecResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
): SecState<T> {
  const [state, setState] = useState<SecState<T>>(IDLE);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (key === null) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null, status: null });
    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null, status: null });
        }
      })
      .catch((error: unknown) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setState({
          data: null,
          loading: false,
          error:
            error instanceof ApiError ? error.message : "Something went wrong.",
          status: error instanceof ApiError ? error.status : null,
        });
      });
    return () => controller.abort();
  }, [key]);

  return state;
}
