import { useLayoutEffect, useRef, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

const ZERO: Size = { width: 0, height: 0 };

/**
 * Measure an element, tracking it through resizes.
 *
 * Exists because Recharts' `ResponsiveContainer` measures on mount, which for a
 * lazily-loaded chart happens before the browser has laid the new subtree out.
 * It reads 0, reports `width(-1) and height(-1)`, and renders an empty frame
 * until a ResizeObserver callback rescues it one tick later — the transient
 * blank chart area. Measuring first and only then handing the chart concrete
 * pixel dimensions removes the invalid state entirely rather than waiting it
 * out.
 *
 * `useLayoutEffect` so the first measurement lands before paint, and the
 * initial 0×0 render is never visible.
 */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>(ZERO);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      // Round to whole pixels: sub-pixel churn from a flex parent would
      // otherwise rerender the chart on every fractional resize.
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
