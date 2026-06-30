import * as React from "react";

type UseProgressiveListOptions = {
  initial?: number;
  step?: number;
  enabled?: boolean;
  deps?: unknown[];
  rootRef?: React.RefObject<Element | null>;
  rootMargin?: string;
};

export function useProgressiveList<T>(
  items: T[],
  options: UseProgressiveListOptions = {}
) {
  const initial = Math.max(1, Number(options.initial ?? 12));
  const step = Math.max(1, Number(options.step ?? initial));
  const enabled = options.enabled !== false;
  const rootMargin = options.rootMargin || "220px 0px";
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const depsKey = React.useMemo(
    () => (options.deps || []).map((item) => String(item)).join("|"),
    [options.deps]
  );

  const [visibleCount, setVisibleCount] = React.useState(() =>
    enabled ? Math.min(items.length, initial) : items.length
  );

  React.useEffect(() => {
    if (!enabled) {
      setVisibleCount(items.length);
      return;
    }
    setVisibleCount(Math.min(items.length, initial));
  }, [enabled, initial, items.length, depsKey]);

  const hasMore = enabled && visibleCount < items.length;
  const visibleItems = React.useMemo(
    () => (enabled ? items.slice(0, visibleCount) : items),
    [enabled, items, visibleCount]
  );

  React.useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((prev) => Math.min(items.length, prev + step));
      },
      {
        root: options.rootRef?.current || null,
        rootMargin,
        threshold: 0
      }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, items.length, options.rootRef, rootMargin, step]);

  return {
    visibleItems,
    visibleCount,
    setVisibleCount,
    hasMore,
    sentinelRef
  };
}

