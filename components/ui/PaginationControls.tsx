type PaginationControlsProps = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  locale?: "zh" | "en";
};

const DEFAULT_SIZES = [10, 20, 50, 100];

export function PaginationControls({
  total,
  page,
  pageSize,
  pageCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  locale = "zh"
}: PaginationControlsProps) {
  const sizes = pageSizeOptions && pageSizeOptions.length ? pageSizeOptions : DEFAULT_SIZES;
  const safePage = Math.min(Math.max(page, 1), pageCount);

  return (
    <div className="px-6 py-4 border-t border-white/10 flex flex-wrap items-center gap-2 text-xs text-white/55">
      <span>
        {locale === "zh" ? "共" : "Total"} {total} {locale === "zh" ? "条" : "items"}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, safePage - 1))}
        disabled={safePage <= 1}
        className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40"
      >
        {locale === "zh" ? "上一页" : "Prev"}
      </button>
      <span className="text-white/70">
        {safePage} / {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
        disabled={safePage >= pageCount}
        className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40"
      >
        {locale === "zh" ? "下一页" : "Next"}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span>{locale === "zh" ? "每页" : "Per page"}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="min-w-[96px] rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
