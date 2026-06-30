"use client";

import React from "react";
import { createPortal } from "react-dom";

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ left: number; top: number } | null>(null);
  const triggerRef = React.useRef<HTMLSpanElement | null>(null);

  const updatePosition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const clamped = Math.min(Math.max(center, 12), window.innerWidth - 12);
    setCoords({ left: clamped, top: rect.bottom + 8 });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePosition]);

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <span
              className="pointer-events-none fixed z-[9999] w-max max-w-[320px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-xs text-white/90 shadow-lg"
              style={{ left: coords.left, top: coords.top }}
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

