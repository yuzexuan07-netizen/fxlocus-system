"use client";

import React from "react";

type Props = {
  locale: "zh" | "en";
  onChange: (ok: boolean) => void;
  disabled?: boolean;
  resetSignal?: string | number;
};

type MathChallenge = { mode: "math"; expression: string; answer: number; options: number[] };
type BeamChallenge = { mode: "beam"; target: number; tolerance: number };
type Challenge = MathChallenge | BeamChallenge;

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeMathChallenge(): MathChallenge {
  const variant = randInt(0, 2);
  let expression = "";
  let answer = 0;

  if (variant === 0) {
    const a = randInt(7, 17);
    const b = randInt(4, 11);
    const c = randInt(2, 7);
    expression = `${a} + ${b} - ${c}`;
    answer = a + b - c;
  } else if (variant === 1) {
    const a = randInt(3, 7);
    const b = randInt(2, 5);
    const c = randInt(3, 9);
    expression = `${a} x ${b} + ${c}`;
    answer = a * b + c;
  } else {
    const a = randInt(18, 34);
    const b = randInt(4, 10);
    expression = `${a} - ${b}`;
    answer = a - b;
  }

  const options = shuffle(
    Array.from(
      new Set([
        answer,
        answer + randInt(1, 4),
        Math.max(0, answer - randInt(1, 4)),
        answer + randInt(5, 9),
        Math.max(0, answer - randInt(5, 8))
      ])
    )
  ).slice(0, 4);
  if (!options.includes(answer)) options[0] = answer;
  return { mode: "math", expression, answer, options: shuffle(options) };
}

function makeChallenge(previousMode: Challenge["mode"] | null): Challenge {
  const nextMode =
    previousMode === "math" ? "beam" : previousMode === "beam" ? "math" : randInt(0, 1) === 0 ? "math" : "beam";
  if (nextMode === "math") return makeMathChallenge();
  return { mode: "beam", target: randInt(24, 76), tolerance: randInt(5, 7) };
}

export function SliderCaptcha({ locale, onChange, disabled, resetSignal }: Props) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const lastModeRef = React.useRef<Challenge["mode"] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [verified, setVerified] = React.useState(false);
  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [beamValue, setBeamValue] = React.useState(0);
  const [beamDragging, setBeamDragging] = React.useState(false);

  React.useEffect(() => onChange(verified), [onChange, verified]);

  React.useEffect(() => {
    setOpen(false);
    setVerified(false);
    setChallenge(null);
    setError(null);
    setBeamValue(0);
    setBeamDragging(false);
  }, [resetSignal]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const refreshChallenge = React.useCallback(() => {
    const next = makeChallenge(lastModeRef.current);
    lastModeRef.current = next.mode;
    setChallenge(next);
    setBeamValue(0);
    setBeamDragging(false);
    setError(null);
    setOpen(true);
  }, []);

  const reset = React.useCallback(() => {
    setOpen(false);
    setVerified(false);
    setChallenge(null);
    setError(null);
    setBeamValue(0);
    setBeamDragging(false);
  }, []);

  const openChallenge = () => {
    if (disabled || verified) return;
    refreshChallenge();
  };

  const finishSuccess = () => {
    setVerified(true);
    setError(null);
    setBeamDragging(false);
    window.setTimeout(() => setOpen(false), 320);
  };

  const answerMath = (value: number) => {
    if (!challenge || challenge.mode !== "math" || verified) return;
    if (value === challenge.answer) {
      finishSuccess();
      return;
    }
    setError(locale === "zh" ? "答案不正确，已切换新题。" : "Wrong answer. Switched to a fresh challenge.");
    const next = makeMathChallenge();
    lastModeRef.current = next.mode;
    setChallenge(next);
  };

  const updateBeam = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    const next = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
    setBeamValue(next);
    return next;
  };

  const submitBeam = (value = beamValue) => {
    if (!challenge || challenge.mode !== "beam" || verified) return;
    if (Math.abs(value - challenge.target) <= challenge.tolerance) {
      setBeamValue(challenge.target);
      finishSuccess();
      return;
    }
    setError(locale === "zh" ? "没有拖入高亮窗口，请重试。" : "Beam missed the highlighted window. Try again.");
    setBeamValue(0);
  };

  const statusText = verified
    ? locale === "zh"
      ? "已通过安全验证"
      : "Verification passed"
    : disabled
      ? locale === "zh"
        ? "请先选择账号类型并填写账号密码"
        : "Choose account type and fill in credentials first"
      : locale === "zh"
        ? "点击按钮打开弹窗验证"
        : "Tap to open verification";

  return (
    <div className="system-captcha-card rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-white">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10">
          <span className="h-3 w-3 rounded-full bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.9)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            {locale === "zh" ? "安全验证" : "Verification"}
          </div>
          <div className="mt-0.5 truncate text-sm text-white/70">{statusText}</div>
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={!verified}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55 disabled:opacity-35"
        >
          {locale === "zh" ? "重置" : "Reset"}
        </button>
      </div>

      <button
        type="button"
        onClick={openChallenge}
        disabled={disabled || verified}
        className={[
          "mt-3 w-full rounded-2xl border px-4 py-3 text-center text-sm transition-colors",
          verified
            ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
            : disabled
              ? "cursor-not-allowed border-white/10 bg-white/[0.04] text-white/40"
              : "border-white/12 bg-white/[0.08] text-white/80 hover:bg-white/[0.12]"
        ].join(" ")}
      >
        {verified
          ? locale === "zh"
            ? "验证通过，可以登录"
            : "Verified, ready to sign in"
          : locale === "zh"
            ? "打开安全验证"
            : "Open verification"}
      </button>

      {open && challenge ? (
        <div className="captcha-popup-root" role="dialog" aria-modal="true" aria-label={locale === "zh" ? "安全验证" : "Verification"}>
          <button
            type="button"
            className="captcha-popup-backdrop"
            aria-label={locale === "zh" ? "关闭验证" : "Close verification"}
            onClick={() => setOpen(false)}
          />
          <div className="captcha-popup-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">{locale === "zh" ? "安全验证" : "Verification"}</div>
                <div className="mt-0.5 text-xs text-white/45">
                  {locale === "zh" ? "完成后返回登录" : "Complete this to continue"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 rounded-full border border-white/10 px-3 text-xs text-white/60"
              >
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>

            {challenge.mode === "math" ? (
              <div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
                  <div className="text-xs uppercase tracking-[0.14em] text-white/40">
                    {locale === "zh" ? "选择正确结果" : "Choose the correct result"}
                  </div>
                  <div className="mt-3 text-3xl font-semibold tracking-wide text-white">
                    {challenge.expression} <span className="text-white/40">=</span> <span className="text-sky-200">?</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {challenge.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => answerMath(option)}
                      className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-left text-lg font-semibold text-white/85"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div ref={trackRef} className="captcha-beam-stage">
                  <div className="captcha-beam-grid" />
                  <div
                    className="captcha-beam-window"
                    style={{ left: `${challenge.target - challenge.tolerance}%`, width: `${challenge.tolerance * 2}%` }}
                  />
                  <div className="captcha-beam-line" style={{ left: `${beamValue}%` }} />
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                  <div className="relative h-12 rounded-2xl bg-black/25">
                    <div className="absolute inset-y-0 left-0 rounded-2xl bg-white/10" style={{ width: `${beamValue}%` }} />
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        setBeamDragging(true);
                        updateBeam(event.clientX);
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                      }}
                      onPointerMove={(event) => beamDragging && updateBeam(event.clientX)}
                      onPointerUp={(event) => {
                        event.currentTarget.releasePointerCapture?.(event.pointerId);
                        setBeamDragging(false);
                        submitBeam(updateBeam(event.clientX));
                      }}
                      onPointerCancel={() => {
                        setBeamDragging(false);
                        submitBeam();
                      }}
                      className="captcha-beam-knob"
                      style={{ left: `calc(${beamValue}% - 24px)` }}
                      aria-label={locale === "zh" ? "拖动滑块" : "Drag slider"}
                    >
                      <span />
                    </button>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs tracking-[0.1em] text-white/45">
                      {locale === "zh" ? "拖动至高亮窗口" : "Drag into the window"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={refreshChallenge}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60"
              >
                {locale === "zh" ? "换一个" : "New challenge"}
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .captcha-popup-root {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0;
          padding: 24px;
        }
        .captcha-popup-backdrop {
          position: absolute;
          inset: 0;
          display: block;
          border: 0;
          background: rgba(0, 0, 0, 0.62);
          backdrop-filter: blur(10px);
        }
        .captcha-popup-panel {
          position: relative;
          z-index: 1;
          width: min(100%, 420px);
          max-height: min(86dvh, 560px);
          overflow-y: auto;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: linear-gradient(180deg, rgba(20, 25, 38, 0.98), rgba(10, 14, 24, 0.98));
          padding: 12px;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.58);
        }
        .captcha-beam-stage {
          position: relative;
          height: 112px;
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: radial-gradient(circle at 20% 28%, rgba(255, 255, 255, 0.08), transparent 30%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0));
        }
        .captcha-beam-grid {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(0deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
          background-size: 28px 28px;
          opacity: 0.45;
        }
        .captcha-beam-window {
          position: absolute;
          top: 14px;
          bottom: 14px;
          border-radius: 16px;
          border: 1px solid rgba(125, 211, 252, 0.32);
          background: rgba(125, 211, 252, 0.16);
          box-shadow: 0 0 24px rgba(125, 211, 252, 0.22);
        }
        .captcha-beam-line {
          position: absolute;
          top: 10px;
          bottom: 10px;
          width: 3px;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), #7dd3fc, rgba(255, 255, 255, 0.2));
          transform: translateX(-50%);
          box-shadow: 0 0 20px rgba(125, 211, 252, 0.8);
        }
        .captcha-beam-knob {
          position: absolute;
          z-index: 1;
          top: 50%;
          width: 48px;
          height: 48px;
          transform: translateY(-50%);
          touch-action: none;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06));
          box-shadow: 0 16px 32px rgba(0, 0, 0, 0.28);
        }
        .captcha-beam-knob span {
          position: absolute;
          inset: 11px;
          border-radius: 14px;
          background: linear-gradient(180deg, #7dd3fc, rgba(255, 255, 255, 0.32));
          box-shadow: 0 0 18px rgba(125, 211, 252, 0.75);
        }
        @media (max-width: 767px) {
          .captcha-popup-root {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            margin: 0;
            padding: 12px max(12px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom))
              max(12px, env(safe-area-inset-left));
          }
          .captcha-popup-backdrop {
            position: absolute;
            inset: 0;
            display: block;
            border: 0;
            background: rgba(0, 0, 0, 0.62);
            backdrop-filter: blur(8px);
          }
          .captcha-popup-panel {
            position: relative;
            z-index: 1;
            width: min(100%, 430px);
            max-height: min(82dvh, 560px);
            overflow-y: auto;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: linear-gradient(180deg, rgba(20, 25, 38, 0.98), rgba(10, 14, 24, 0.98));
            padding: 16px;
            box-shadow: 0 30px 90px rgba(0, 0, 0, 0.58);
          }
          .captcha-popup-panel button {
            min-height: 44px;
          }
          .captcha-beam-stage {
            height: 130px;
          }
        }
      `}</style>
    </div>
  );
}
