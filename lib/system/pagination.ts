import type { NextRequest } from "next/server";

type PaginationOptions = {
  defaultPageSize?: number;
  maxPageSize?: number;
};

export function getPagination(request: NextRequest, options: PaginationOptions = {}) {
  const defaultPageSize = options.defaultPageSize ?? 20;
  const maxPageSize = options.maxPageSize ?? 200;
  const params = request.nextUrl.searchParams;
  const rawPage = Number(params.get("page") || "1");
  const rawSize = Number(params.get("pageSize") || String(defaultPageSize));
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? Math.floor(rawSize) : defaultPageSize;
  const safeSize = Math.min(Math.max(pageSize, 1), maxPageSize);
  const from = (page - 1) * safeSize;
  const to = from + safeSize - 1;
  return { page, pageSize: safeSize, from, to };
}
