"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";

export function BfcacheGuard({ locale }: { locale: "zh" | "en" }) {
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      fetchSystemJson<{ ok?: boolean }>("/api/system/me", {
        dedupeKey: "bfcache:me",
        dedupeWindowMs: 1500,
        retries: 1
      })
        .then((result) => {
          const json = (result.body || null) as any;
          if (!result.ok || !json?.ok) {
            router.replace(`/${locale}/system/login?next=${encodeURIComponent(pathname || "")}`);
          }
        })
        .catch(() => {
          router.replace(`/${locale}/system/login`);
        });
    };

    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [locale, pathname, router]);

  return null;
}
