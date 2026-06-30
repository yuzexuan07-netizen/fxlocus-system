import { useEffect, useMemo, useState } from "react";

type PaginationOptions = {
  pageSize?: number;
  deps?: unknown[];
};

export function usePagination<T>(items: T[], options: PaginationOptions = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(options.pageSize ?? 20);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const depsKey = useMemo(
    () => (options.deps ?? []).map((item) => String(item)).join("|"),
    [options.deps]
  );
  useEffect(() => {
    setPage(1);
  }, [depsKey]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage, pageSize, setPageSize, pageCount, total, pageItems };
}
