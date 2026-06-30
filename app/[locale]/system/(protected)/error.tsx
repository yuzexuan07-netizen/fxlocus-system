"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";

type ProtectedErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ProtectedSystemError({ error, reset }: ProtectedErrorProps) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = params?.locale === "en" ? "en" : "zh";

  React.useEffect(() => {
    console.error("[system/protected] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-center">
        <div className="text-lg font-semibold text-rose-100">
          {locale === "zh" ? "\u9875\u9762\u52a0\u8f7d\u5f02\u5e38" : "Page failed to load"}
        </div>
        <div className="mt-2 text-sm text-rose-100/85">
          {locale === "zh"
            ? "\u5df2\u6355\u83b7\u524d\u7aef\u5f02\u5e38\uff0c\u8bf7\u5148\u91cd\u8bd5\uff1b\u82e5\u4ecd\u5931\u8d25\uff0c\u53ef\u8fd4\u56de\u540e\u53f0\u9996\u9875\u7ee7\u7eed\u64cd\u4f5c\u3002"
            : "A client-side exception was captured. Retry first, or return to dashboard."}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
          >
            {locale === "zh" ? "\u91cd\u8bd5" : "Retry"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/system`)}
            className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
          >
            {locale === "zh" ? "\u8fd4\u56de\u540e\u53f0\u9996\u9875" : "Back to dashboard"}
          </button>
        </div>
      </div>
    </div>
  );
}

