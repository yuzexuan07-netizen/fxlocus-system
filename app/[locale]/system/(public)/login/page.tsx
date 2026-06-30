"use client";

import React from "react";
import { ChevronDown, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { SliderCaptcha } from "@/components/system/SliderCaptcha";
import { SystemLoadingScreen } from "@/components/system/SystemLoadingScreen";
import { stopSystemMusic } from "@/lib/system/musicControl";
import { isAdminRole } from "@/lib/system/roles";

type LoginRole = "" | "student" | "trader" | "coach" | "assistant" | "leader" | "super_admin";

type LoginResponse =
  | {
      ok: true;
      user: {
        id: string;
        full_name: string | null;
        role: "student" | "trader" | "coach" | "assistant" | "leader" | "super_admin";
      };
    }
  | { ok: false; error: string };

type RoleOption = {
  value: Exclude<LoginRole, "">;
  label: { zh: string; en: string };
};

const stripCjk = (value: string) => value.replace(/[\u3400-\u9fff]/g, "");

const ROLE_OPTIONS: RoleOption[] = [
  { value: "student", label: { zh: "数据采集员", en: "Data Collector" } },
  { value: "coach", label: { zh: "教练", en: "Coach" } },
  { value: "assistant", label: { zh: "助教", en: "Assistant" } },
  { value: "leader", label: { zh: "团队长", en: "Leader" } },
  { value: "super_admin", label: { zh: "超管", en: "Super Admin" } }
];
const LOGIN_ATTEMPT_TIMEOUT_MS = 15_000;

function wait(ms: number) {
  if (!ms) return Promise.resolve();
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isTransientLoginFailure(status: number, code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return (
    status === 429 ||
    status === 503 ||
    normalized === "RATE_LIMITED" ||
    normalized === "TOO_MANY_REQUESTS" ||
    normalized === "DB_BUSY" ||
    normalized === "SERVICE_UNAVAILABLE"
  );
}

function RoleSelect({
  locale,
  value,
  onChange,
  disabled
}: {
  locale: "zh" | "en";
  value: LoginRole;
  onChange: (next: LoginRole) => void;
  disabled?: boolean;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const selectedIndex = value ? ROLE_OPTIONS.findIndex((o) => o.value === value) : -1;
  const displayText = value
    ? ROLE_OPTIONS.find((o) => o.value === value)?.label[locale] ?? ""
    : locale === "zh"
      ? "请选择账号类型"
      : "Select account type";

  const close = React.useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);

  const openMenu = React.useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    window.setTimeout(() => {
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      optionRefs.current[idx]?.focus();
    }, 0);
  }, [disabled, selectedIndex]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (!root.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [close, open]);

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openMenu();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const onOptionKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(ROLE_OPTIONS.length - 1, activeIndex + 1);
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, activeIndex - 1);
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
      return;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          "w-full flex items-center justify-between rounded-2xl border px-4 py-3 text-sm transition-colors",
          "bg-white/10 border-white/10 hover:bg-white/15 focus:outline-none focus:border-white/30",
          disabled ? "opacity-60 cursor-not-allowed hover:bg-white/10" : "",
          value ? "text-white/90" : "text-white/70"
        ].join(" ")}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown
          className={[
            "h-4 w-4 text-white/50 transition-transform",
            open ? "rotate-180" : "rotate-0"
          ].join(" ")}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={locale === "zh" ? "账号类型" : "Account type"}
          className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#050a14]/95 shadow-2xl backdrop-blur-xl"
        >
          {ROLE_OPTIONS.map((opt, idx) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(idx)}
                onKeyDown={onOptionKeyDown}
                onClick={() => {
                  onChange(opt.value);
                  close();
                }}
                className={[
                  "w-full flex items-center px-4 py-3 text-left text-sm",
                  "text-white/90 outline-none",
                  idx === activeIndex ? "bg-white/10" : "bg-transparent",
                  isSelected ? "border-l-2 border-sky-300/70" : "border-l-2 border-transparent",
                  "hover:bg-white/10"
                ].join(" ")}
              >
                {opt.label[locale]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function SystemLoginPage({ params }: { params: { locale: "zh" | "en" } }) {
  const locale = params.locale === "en" ? "en" : "zh";
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginRole, setLoginRole] = React.useState<LoginRole>("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [checkingExistingSession, setCheckingExistingSession] = React.useState(false);
  const [captchaOk, setCaptchaOk] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canStartCaptcha = Boolean(loginRole && identifier.trim() && password.trim());
  const captchaResetSignal = `${loginRole}|${identifier.trim()}|${password.trim()}`;
  const sessionNotice = React.useMemo(() => {
    const reason = searchParams?.get("reason");
    if (reason === "session_mismatch") {
      return locale === "zh"
        ? "检测到账号在其他设备登录。如非本人操作，请立即修改密码。"
        : "We detected a login from another device. If this wasn't you, change your password.";
    }
    return null;
  }, [locale, searchParams]);

  React.useEffect(() => {
    stopSystemMusic({ resetSource: true, clearSavedState: true });
  }, []);

  React.useEffect(() => {
    if (!isMobileAppRuntime()) return;
    let cancelled = false;
    setCheckingExistingSession(true);
    fetch("/api/system/auth/me", {
      credentials: "include",
      cache: "no-store"
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json().catch(() => null);
      })
      .then((data) => {
        if (cancelled) return;
        const role = String(data?.user?.role || "") as Exclude<LoginRole, "">;
        if (role && ROLE_OPTIONS.some((option) => option.value === role)) {
          window.location.replace(getPostLoginPath(locale, role, true));
          return;
        }
        setCheckingExistingSession(false);
      })
      .catch(() => {
        if (!cancelled) setCheckingExistingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  React.useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.height = "100%";
    body.style.height = "100%";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.height = prevHtmlHeight;
      body.style.height = prevBodyHeight;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!loginRole) {
      setError(locale === "zh" ? "请选择账号类型" : "Select account type.");
      return;
    }
    if (!captchaOk) {
      setError(locale === "zh" ? "请先完成图形拖动验证" : "Complete the drag verification first.");
      return;
    }
    setLoading(true);
    try {
      let res: Response | null = null;
      let json: LoginResponse | null = null;
      let errorCode = "";
      let timedOut = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, LOGIN_ATTEMPT_TIMEOUT_MS + attempt * 3000);
        try {
          res = await fetch("/api/system/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ identifier, password, role: loginRole }),
            signal: controller.signal
          });
          json = (await res.json().catch(() => null)) as LoginResponse | null;
          errorCode = String((json as any)?.error || "");
          if (!isTransientLoginFailure(res.status, errorCode) || attempt >= 2) break;
        } catch (fetchError: any) {
          if (controller.signal.aborted) {
            errorCode = "REQUEST_TIMEOUT";
            if (attempt >= 2) throw fetchError;
          } else {
            throw fetchError;
          }
        } finally {
          window.clearTimeout(timeoutId);
        }
        await wait(500 + attempt * 500);
      }
      if (!res) {
        setError(
          timedOut
            ? locale === "zh"
              ? "登录请求超时，请重试。若频繁出现，请稍后再试。"
              : "Sign-in timed out. Please retry shortly."
            : locale === "zh"
              ? "登录失败，请稍后重试"
              : "Sign in failed."
        );
        setLoading(false);
        return;
      }
      if (!res.ok || !json?.ok) {
        const code = String((json as any)?.error || "");
        if (code === "ROLE_MISMATCH") {
          setError(
            locale === "zh"
              ? "账号类型不匹配，请检查选择的账号类型（权限）"
              : "Account type mismatch. Please check the selected account type."
          );
        } else if (code === "INVALID_EMAIL") {
          setError(locale === "zh" ? "邮箱格式不正确" : "Invalid email format.");
        } else if (code === "INVALID_CREDENTIALS") {
          setError(
            locale === "zh"
              ? "账号或密码错误，请仔细检查账号、密码以及账号类型（权限）"
              : "Invalid credentials. Please check email/password and account type."
          );
        } else if (isTransientLoginFailure(res.status, code)) {
          setError(locale === "zh" ? "服务繁忙，请稍后重试" : "Service is busy. Please retry.");
        } else {
          setError(locale === "zh" ? "登录失败，请稍后重试" : "Sign in failed.");
        }
        setLoading(false);
        return;
      }

      const next = getPostLoginPath(locale, json.user.role, isMobileAppRuntime());
      window.location.assign(next);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setError(
          locale === "zh"
            ? "登录请求超时，请重试。若频繁出现，请稍后再试。"
            : "Sign-in timed out. Please retry shortly."
        );
      } else {
        setError(e?.message || (locale === "zh" ? "网络异常，请稍后重试" : "Network error."));
      }
      setLoading(false);
    }
  };

  if (loading || checkingExistingSession) {
    return (
      <SystemLoadingScreen
        locale={locale}
        label={
          checkingExistingSession
            ? locale === "zh"
              ? "正在恢复登录…"
              : "Restoring session…"
            : locale === "zh"
              ? "登录中…"
              : "Signing in…"
        }
      />
    );
  }

  return (
    <div className="login-shell relative h-full min-h-full w-full overflow-hidden">
      <div className="absolute inset-0 opacity-85">
        <div className="login-stars absolute inset-0" />
        <div className="login-particles absolute left-1/2 top-1/2" />
        <div className="login-particles login-particles-b absolute left-1/2 top-1/2" />
        <div className="login-glow login-glow-a absolute left-1/2 top-1/2 h-[560px] w-[560px] rounded-full blur-[130px]" />
        <div className="login-glow login-glow-b absolute left-1/2 top-1/2 h-[380px] w-[380px] rounded-full blur-[100px]" />
        <div className="login-ring absolute left-1/2 top-1/2 h-[700px] w-[700px] rounded-full border border-white/10" />
        <div className="login-ripple login-ripple-a absolute left-1/2 top-1/2 h-[520px] w-[520px] rounded-full" />
        <div className="login-ripple login-ripple-b absolute left-1/2 top-1/2 h-[720px] w-[720px] rounded-full" />
        <div className="login-ripple login-ripple-c absolute left-1/2 top-1/2 h-[880px] w-[880px] rounded-full" />
        <div className="login-sweep absolute left-1/2 top-1/2 h-[760px] w-[760px] rounded-full" />
        <div className="login-orbit absolute left-1/2 top-1/2 h-[640px] w-[640px] rounded-full" />
        <div className="login-orbit login-orbit-slow absolute left-1/2 top-1/2 h-[820px] w-[820px] rounded-full" />
      </div>

      <div className="relative z-10 flex h-full min-h-full w-full items-center justify-center px-4 py-10">
        <form
          onSubmit={submit}
          autoComplete="off"
          className="relative w-full max-w-[420px] rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl"
        >
            <div className="text-white/90 text-lg font-semibold">
              {locale === "zh" ? "系统登录" : "System Login"}
            </div>
            <div className="mt-1 text-white/50 text-sm">
              {locale === "zh" ? "请输入账号与密码" : "Enter your credentials"}
            </div>

            <div className="mt-6 space-y-3">
              <div className="relative">
                <RoleSelect
                  locale={locale}
                  value={loginRole}
                  onChange={setLoginRole}
                  disabled={loading}
                />
              </div>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  name="system-identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(stripCjk(e.target.value))}
                  className="w-full rounded-2xl bg-white/5 border border-white/10 px-10 py-3 text-white/85 text-sm focus:outline-none focus:border-white/30"
                  placeholder={locale === "zh" ? "邮箱" : "Email"}
                  autoComplete="off"
                  inputMode="email"
                  autoCapitalize="none"
                  required
                />
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  name="system-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(stripCjk(e.target.value))}
                  className="w-full rounded-2xl bg-white/5 border border-white/10 px-10 py-3 text-white/85 text-sm focus:outline-none focus:border-white/30"
                  placeholder={locale === "zh" ? "请输入密码" : "Password"}
                  autoComplete="new-password"
                  inputMode="text"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                  aria-label={showPassword ? "hide password" : "show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <SliderCaptcha
                locale={locale}
                disabled={!canStartCaptcha || loading}
                resetSignal={captchaResetSignal}
                onChange={setCaptchaOk}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !loginRole || !identifier.trim() || !password.trim() || !captchaOk}
              className="mt-6 w-full px-4 py-3 rounded-2xl bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-50"
            >
              {loading ? (locale === "zh" ? "登录中..." : "Signing in...") : locale === "zh" ? "登录" : "Sign in"}
            </button>

            {sessionNotice ? (
              <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {sessionNotice}
              </div>
            ) : null}
            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
        </form>
      </div>
      <style jsx>{`
        .login-shell {
          --login-bg-top: rgba(5, 10, 22, 0.98);
          --login-bg-bottom: rgba(3, 7, 18, 0.99);
          --login-nebula-a: rgba(76, 162, 255, 0.16);
          --login-nebula-b: rgba(99, 102, 241, 0.12);
          --login-nebula-c: rgba(56, 189, 248, 0.1);
          --login-color-1: rgba(125, 211, 252, 0.72);
          --login-color-2: rgba(99, 102, 241, 0.62);
          --login-color-3: rgba(56, 189, 248, 0.56);
          --login-color-4: rgba(59, 130, 246, 0.5);
          --login-particle-base: rgba(148, 163, 184, 0.9);
          --login-glow-a-color: radial-gradient(circle, rgba(56, 189, 248, 0.24) 0%, rgba(56, 189, 248, 0.12) 42%, transparent 74%);
          --login-glow-b-color: radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, rgba(99, 102, 241, 0.1) 40%, transparent 74%);
          --login-ring-border: rgba(125, 211, 252, 0.2);
          --login-ring-shadow: rgba(59, 130, 246, 0.35);
          --login-ripple-a: rgba(125, 211, 252, 0.25);
          --login-ripple-b: rgba(99, 102, 241, 0.22);
          --login-ripple-c: rgba(56, 189, 248, 0.24);
          background:
            radial-gradient(circle at 18% 18%, var(--login-nebula-a), transparent 44%),
            radial-gradient(circle at 82% 22%, var(--login-nebula-b), transparent 48%),
            radial-gradient(circle at 50% 84%, var(--login-nebula-c), transparent 54%),
            linear-gradient(180deg, var(--login-bg-top), var(--login-bg-bottom));
        }
        :global(html[data-site-theme="theme-2"]) .login-shell {
          --login-bg-top: rgba(9, 7, 14, 0.98);
          --login-bg-bottom: rgba(18, 10, 22, 0.99);
          --login-nebula-a: rgba(196, 126, 255, 0.18);
          --login-nebula-b: rgba(255, 214, 158, 0.14);
          --login-nebula-c: rgba(124, 34, 60, 0.2);
          --login-color-1: rgba(255, 236, 220, 0.76);
          --login-color-2: rgba(214, 142, 255, 0.58);
          --login-color-3: rgba(244, 155, 219, 0.5);
          --login-color-4: rgba(255, 173, 112, 0.52);
          --login-particle-base: rgba(255, 244, 236, 0.9);
          --login-glow-a-color: radial-gradient(circle, rgba(196, 126, 255, 0.24) 0%, rgba(196, 126, 255, 0.12) 42%, transparent 74%);
          --login-glow-b-color: radial-gradient(circle, rgba(255, 205, 156, 0.22) 0%, rgba(255, 205, 156, 0.1) 38%, transparent 74%);
          --login-ring-border: rgba(255, 220, 194, 0.16);
          --login-ring-shadow: rgba(196, 126, 255, 0.18);
          --login-ripple-a: rgba(255, 220, 194, 0.16);
          --login-ripple-b: rgba(214, 142, 255, 0.16);
          --login-ripple-c: rgba(255, 173, 112, 0.18);
        }
        .login-stars {
          background-image: radial-gradient(circle at 20% 30%, var(--login-color-1), transparent 58%),
            radial-gradient(circle at 80% 40%, var(--login-color-2), transparent 58%),
            radial-gradient(circle at 60% 80%, var(--login-color-3), transparent 60%),
            radial-gradient(circle at 10% 80%, var(--login-color-4), transparent 58%),
            radial-gradient(circle at 90% 15%, color-mix(in srgb, var(--login-color-4) 86%, transparent), transparent 58%),
            radial-gradient(circle at 35% 55%, color-mix(in srgb, var(--login-color-3) 84%, transparent), transparent 60%),
            radial-gradient(circle at 70% 20%, color-mix(in srgb, var(--login-color-2) 82%, transparent), transparent 60%),
            radial-gradient(circle at 15% 20%, color-mix(in srgb, var(--login-color-1) 76%, transparent), transparent 60%);
          background-size: 100% 100%;
          background-position: center;
          background-repeat: no-repeat;
          opacity: 0.75;
          animation: loginTwinkle 2.4s ease-in-out infinite;
          animation-delay: -1.2s;
        }
        .login-particles {
          width: 2px;
          height: 2px;
          border-radius: 9999px;
          background: var(--login-particle-base);
          box-shadow:
            -420px -260px color-mix(in srgb, var(--login-color-1) 100%, white 6%),
            -340px -40px color-mix(in srgb, var(--login-color-2) 100%, white 4%),
            -200px -200px color-mix(in srgb, var(--login-color-3) 100%, white 4%),
            -60px 160px color-mix(in srgb, var(--login-color-4) 96%, white 4%),
            40px -140px color-mix(in srgb, var(--login-color-1) 100%, white 6%),
            140px 20px color-mix(in srgb, var(--login-color-2) 98%, white 4%),
            220px -220px color-mix(in srgb, var(--login-color-3) 98%, white 4%),
            260px 160px color-mix(in srgb, var(--login-color-4) 94%, white 4%),
            340px -60px color-mix(in srgb, var(--login-color-1) 100%, white 8%),
            420px 140px color-mix(in srgb, var(--login-color-2) 100%, white 5%),
            -520px 140px color-mix(in srgb, var(--login-color-3) 94%, white 4%),
            -360px 300px color-mix(in srgb, var(--login-color-4) 90%, white 4%),
            -80px 280px color-mix(in srgb, var(--login-color-1) 90%, white 4%),
            60px 240px color-mix(in srgb, var(--login-color-2) 88%, white 4%),
            180px 300px color-mix(in srgb, var(--login-color-3) 90%, white 4%),
            420px -220px color-mix(in srgb, var(--login-color-4) 98%, white 4%),
            540px 20px color-mix(in srgb, var(--login-color-1) 94%, white 4%),
            -560px -60px color-mix(in srgb, var(--login-color-2) 92%, white 4%),
            520px -120px color-mix(in srgb, var(--login-color-3) 90%, white 4%),
            -260px 80px color-mix(in srgb, var(--login-color-1) 88%, white 4%),
            -620px -220px color-mix(in srgb, var(--login-color-3) 96%, white 4%),
            -460px 220px color-mix(in srgb, var(--login-color-1) 92%, white 4%),
            -120px -320px color-mix(in srgb, var(--login-color-2) 92%, white 4%),
            120px -320px color-mix(in srgb, var(--login-color-3) 92%, white 4%),
            320px -320px color-mix(in srgb, var(--login-color-1) 88%, white 4%),
            480px 260px color-mix(in srgb, var(--login-color-2) 92%, white 4%),
            620px 200px color-mix(in srgb, var(--login-color-3) 96%, white 4%),
            640px -40px color-mix(in srgb, var(--login-color-1) 96%, white 4%);
          transform: translate(-50%, -50%);
          animation: loginDrift 48s ease-in-out infinite alternate, loginTwinkle 1.7s ease-in-out infinite;
          animation-delay: -12s, -0.6s;
          opacity: 0.95;
        }
        .login-particles-b {
          width: 3px;
          height: 3px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--login-color-3) 94%, white 6%);
          box-shadow:
            -700px -180px color-mix(in srgb, var(--login-color-1) 94%, white 4%),
            -520px -320px color-mix(in srgb, var(--login-color-2) 98%, white 4%),
            -320px -120px color-mix(in srgb, var(--login-color-3) 90%, white 4%),
            -180px 260px color-mix(in srgb, var(--login-color-4) 92%, white 4%),
            -20px -360px color-mix(in srgb, var(--login-color-1) 94%, white 4%),
            160px -260px color-mix(in srgb, var(--login-color-2) 92%, white 4%),
            320px -120px color-mix(in srgb, var(--login-color-3) 90%, white 4%),
            420px 240px color-mix(in srgb, var(--login-color-4) 92%, white 4%),
            620px -260px color-mix(in srgb, var(--login-color-1) 98%, white 4%),
            720px 120px color-mix(in srgb, var(--login-color-2) 98%, white 4%),
            -620px 200px color-mix(in srgb, var(--login-color-3) 90%, white 4%),
            -420px 360px color-mix(in srgb, var(--login-color-4) 88%, white 4%),
            -140px 420px color-mix(in srgb, var(--login-color-1) 88%, white 4%),
            120px 420px color-mix(in srgb, var(--login-color-2) 88%, white 4%),
            360px 360px color-mix(in srgb, var(--login-color-3) 92%, white 4%),
            520px 320px color-mix(in srgb, var(--login-color-4) 96%, white 4%);
          transform: translate(-50%, -50%);
          opacity: 0.75;
          animation: loginDrift 72s ease-in-out infinite alternate-reverse, loginTwinkle 1.3s ease-in-out infinite;
          animation-delay: -28s, -0.3s;
        }
        .login-glow {
          transform: translate(-50%, -50%);
          animation: loginFloat 22s ease-in-out infinite;
        }
        .login-glow-a {
          background: var(--login-glow-a-color);
        }
        .login-glow-b {
          background: var(--login-glow-b-color);
          animation-duration: 30s;
          animation-direction: reverse;
        }
        .login-ring {
          transform: translate(-50%, -50%) rotate(0deg);
          border: 1px solid var(--login-ring-border);
          box-shadow: 0 0 120px var(--login-ring-shadow);
          opacity: 0.7;
          animation: loginSpin 80s linear infinite;
        }
        .login-ripple {
          transform: translate(-50%, -50%) scale(0.6);
          border: 1px solid var(--login-ripple-a);
          box-shadow: 0 0 50px color-mix(in srgb, var(--login-ripple-a) 78%, transparent);
          opacity: 0;
          mix-blend-mode: screen;
          animation: loginRipple 6.4s ease-out infinite;
        }
        .login-ripple-b {
          animation-delay: -2s;
          animation-duration: 4.8s;
          border-color: var(--login-ripple-b);
        }
        .login-ripple-c {
          animation-delay: -3.4s;
          animation-duration: 7.2s;
          border-color: var(--login-ripple-c);
        }
        .login-sweep {
          transform: translate(-50%, -50%);
          background: conic-gradient(
            from 0deg,
            rgba(0, 0, 0, 0) 0deg,
            color-mix(in srgb, var(--login-color-4) 92%, transparent) 60deg,
            rgba(0, 0, 0, 0) 120deg,
            color-mix(in srgb, var(--login-color-2) 72%, transparent) 200deg,
            rgba(0, 0, 0, 0) 320deg
          );
          -webkit-mask: radial-gradient(circle, transparent 60%, #000 61%, #000 66%, transparent 67%);
          mask: radial-gradient(circle, transparent 60%, #000 61%, #000 66%, transparent 67%);
          animation: loginSpin 24s linear infinite;
          opacity: 0.95;
        }
        .login-orbit {
          transform: translate(-50%, -50%) rotate(0deg);
          border: 1px dashed rgba(255, 255, 255, 0.08);
          animation: loginSpin 22s linear infinite;
        }
        .login-orbit::before,
        .login-orbit::after {
          content: "";
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--login-color-1) 96%, white 4%);
          box-shadow: 0 0 22px color-mix(in srgb, var(--login-color-1) 96%, white 4%);
        }
        .login-orbit::before {
          left: 50%;
          top: -4px;
          transform: translateX(-50%);
        }
        .login-orbit::after {
          right: -4px;
          top: 50%;
          transform: translateY(-50%);
          background: color-mix(in srgb, var(--login-color-2) 96%, white 4%);
          box-shadow: 0 0 22px color-mix(in srgb, var(--login-color-2) 92%, white 4%);
        }
        .login-orbit-slow {
          animation-duration: 36s;
          border-color: rgba(255, 255, 255, 0.05);
        }
        .login-orbit-slow::before,
        .login-orbit-slow::after {
          width: 6px;
          height: 6px;
          background: color-mix(in srgb, var(--login-color-3) 94%, white 6%);
          box-shadow: 0 0 16px color-mix(in srgb, var(--login-color-3) 90%, white 6%);
        }
        @keyframes loginStars {
          0% {
            background-position: 0 0, 200px 120px, -240px 200px, 160px -200px, -120px -80px, 180px 260px,
              -320px -120px, 260px -160px;
          }
          100% {
            background-position: -2200px 800px, -1500px -800px, 800px -800px, -800px 1100px, 1200px 800px,
              -1100px 1300px, 1100px -900px, -900px 700px;
          }
        }
        @keyframes loginTwinkle {
          0%,
          100% {
            opacity: 0.95;
          }
          50% {
            opacity: 0.45;
          }
        }
        @keyframes loginDrift {
          0% {
            transform: translate(-50%, -50%) translate3d(-30px, 10px, 0);
          }
          50% {
            transform: translate(-50%, -50%) translate3d(40px, -50px, 0);
          }
          100% {
            transform: translate(-50%, -50%) translate3d(-20px, 40px, 0);
          }
        }
        @keyframes loginRipple {
          0% {
            transform: translate(-50%, -50%) scale(0.45);
            opacity: 0.35;
          }
          70% {
            opacity: 0.2;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.45);
            opacity: 0;
          }
        }
        @keyframes loginFloat {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            transform: translate(-50%, -52%) scale(1.08);
          }
        }
        @keyframes loginSpin {
          from {
            transform: translate(-50%, -50%) rotate(0deg);
          }
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        @media (max-width: 767px) {
          .login-shell {
            height: 100dvh;
            min-height: 100dvh;
            overflow: hidden;
            background: #070b14 !important;
          }
          .login-shell > .absolute.inset-0 {
            display: none !important;
          }
          .login-shell * {
            animation: none !important;
          }
          .login-shell > .relative.z-10 {
            height: 100dvh;
            min-height: 100dvh;
            width: 100vw;
            align-items: center;
            justify-content: center;
            padding: calc(env(safe-area-inset-top) + 12px) 14px calc(env(safe-area-inset-bottom) + 12px);
          }
          form {
            width: min(100%, 430px) !important;
            max-width: 430px !important;
            max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px) !important;
            overflow-y: auto !important;
            overscroll-behavior: contain;
            border-radius: 24px !important;
            padding: 18px !important;
            background: linear-gradient(180deg, rgba(20, 25, 38, 0.98), rgba(10, 14, 24, 0.98)) !important;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5) !important;
            backdrop-filter: none !important;
          }
          form > .text-lg {
            font-size: 22px !important;
            line-height: 1.2 !important;
          }
          form > .text-sm {
            font-size: 13px !important;
          }
          form .mt-6 {
            margin-top: 16px !important;
          }
          form .space-y-3 > :not([hidden]) ~ :not([hidden]) {
            margin-top: 11px !important;
          }
          form input,
          form button {
            min-height: 44px !important;
            border-radius: 16px !important;
            font-size: 14px !important;
          }
          .login-shell :global(.system-captcha-card) {
            max-height: 220px;
            overflow-y: auto;
          }
        }
      `}</style>
    </div>
  );
}

function isMobileAppRuntime() {
  if (typeof document !== "undefined" && document.documentElement.getAttribute("data-mobile-app") === "1") {
    return true;
  }
  if (typeof navigator !== "undefined" && /FxLocusMobile/i.test(navigator.userAgent || "")) {
    return true;
  }
  return false;
}

function getPostLoginPath(locale: "zh" | "en", role: Exclude<LoginRole, "">, mobileApp: boolean) {
  if (role === "coach") return `/${locale}/system/coach/trade-logs`;
  if (role === "assistant") return `/${locale}/system/assistant`;
  if (isAdminRole(role)) return `/${locale}/system/admin`;
  if (mobileApp) return `/${locale}/system/notifications`;
  return `/${locale}/system/dashboard`;
}
