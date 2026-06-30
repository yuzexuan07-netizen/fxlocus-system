export default function Loading() {
  return <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[2px] overflow-hidden bg-transparent">
    <div className="system-mobile-route-progress h-full w-1/3" />
  </div>;
}
