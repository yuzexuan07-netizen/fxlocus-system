"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { fetchSystemJson } from "@/lib/system/clientFetch";

type LetterSection = {
  title: string;
  paragraphs?: string[];
  list?: string[];
};

const LETTER_SECTIONS: LetterSection[] = [
  {
    title: "第一封信：先确认边界",
    paragraphs: [
      "欢迎进入系统接入三日体验。本阶段只用于让你了解软件系统、仿真训练流程、模拟交易日志、模拟交易策略和复盘要求。",
      "这里不提供真实账户，不分配真实资金，不连接实盘平台，不提供投资建议，不承诺收益，也不做任何资金分成。你看到的一切任务、记录、图表和评价，都只用于仿真训练与数据质量管理。",
      "三日体验也不代表入职、承揽、合作结算或任何岗位承诺。它只是一个短周期的系统熟悉阶段，用来判断你是否能理解规则、按要求提交资料，并完成基础训练准备。",
      "如果你需要真实账户、实盘服务、资金安排、跟单喊单或收益机会，请不要继续使用本系统；这些都不属于本平台提供的服务。"
    ]
  },
  {
    title: "第二封信：先训练执行",
    list: [
      "先进入文件菜单，申请并阅读第一阶段资料、软件操作说明、绿色安装包和报名表。",
      "按要求完成报名表，不要跳过基本信息，不要随意填写，也不要用别人的资料。",
      "完成资料学习后，进入资料上传页面，提交报名表、试用界面截图和身份/学历等必要材料。",
      "如果流程不清楚，直接通过咨询菜单联系团队长或助教，不要自己猜流程。",
      "本阶段重点不是技巧，而是能否按规则完成动作：阅读、理解、提交、确认、复盘。先重塑认知与执行，再谈策略与技巧。"
    ]
  },
  {
    title: "第三封信：再进入训练",
    list: [
      "数据采集员的训练只发生在仿真环境中，核心是判断、执行、记录、复盘和纪律稳定性。",
      "你要留下的是可复核的证据链：为什么做、怎么做、结果如何、哪里违反规则、下一次如何修正。",
      "团队长负责组织节奏和检查质量；教练、助教负责方法纠偏和流程监督；你负责真实记录自己的模拟行为。",
      "训练表现好、记录认真、纪律稳定，平台可以根据规则提供软件系统的免费或延长使用安排；否则按平台价格有偿使用软件系统。",
      "三日体验结束后，是否继续训练、是否开放更多软件功能、是否进入更长周期，都以系统记录、团队审核和平台规则为准。"
    ]
  }
];

const FLOW_LINE = "进入系统三日体验——阅读三封信——申请并学习资料——提交报名表与截图——审核通过后进入下一阶段训练";

export function TrialAccessClient({
  locale,
  mode
}: {
  locale: "zh" | "en";
  mode: "main" | "confirm";
}) {
  const router = useRouter();
  const [eligible, setEligible] = React.useState<boolean | null>(null);
  const t = React.useCallback((zh: string, en: string) => (locale === "zh" ? zh : en), [locale]);

  React.useEffect(() => {
    if (mode !== "main") return;
    let alive = true;
    (async () => {
      try {
        const result = await fetchSystemJson<{ ok?: boolean; eligible?: boolean }>(
          "/api/system/trial-access/status",
          {
            dedupeKey: "trial-access:status",
            dedupeWindowMs: 3000,
            retries: 1,
            retryBaseMs: 220,
            retryMaxMs: 900
          }
        );
        const json = (result.body || null) as any;
        if (!alive) return;
        if (!result.ok || !json?.ok) {
          setEligible(false);
          return;
        }
        setEligible(Boolean(json.eligible));
      } catch {
        if (!alive) return;
        setEligible(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode]);

  if (mode === "main" && eligible === null) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/60">
        {t("加载中...", "Loading...")}
      </div>
    );
  }

  if (mode === "main" && eligible === false) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70">
        <div className="text-lg text-white/90 font-semibold">
          {t("当前不符合三日体验条件", "Not eligible")}
        </div>
        <div className="mt-3 text-sm text-white/60">
          {t("如有疑问，请联系团队长或通过咨询沟通。", "Contact your leader or consult for help.")}
        </div>
        <button
          type="button"
          onClick={() => router.replace(`/${locale}/system/dashboard`)}
          className="mt-5 inline-flex items-center rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          {t("返回仪表盘", "Back to dashboard")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {mode === "main" ? (
        <>
          <section className="rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100/90">
            <div className="text-base font-semibold">你正在使用【三日体验账号】</div>
            <div className="mt-1 text-sm text-amber-100/80">本阶段仅用于了解系统流程、资料要求与仿真训练边界</div>
            <div className="mt-1 text-sm text-amber-100/70">三日内若未进行任何操作，账号将自动冻结</div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-6">
            <header className="space-y-2">
              <div className="text-white/90 text-2xl font-semibold">系统接入说明</div>
              <div className="text-white/70 text-sm">给新普通学员的三封信</div>
              <div className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
                原则：先重塑认知与执行，再谈策略与技巧
              </div>
            </header>

            <div className="space-y-6">
              {LETTER_SECTIONS.map((section) => (
                <article key={section.title} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="text-white/95 text-lg font-semibold tracking-tight">{section.title}</div>
                  <div className="mt-4 space-y-3 text-sm text-white/70 leading-7">
                    {section.paragraphs?.map((p, idx) => (
                      <p key={`${section.title}-p-${idx}`}>{p}</p>
                    ))}
                    {section.list ? (
                      <ol className="list-decimal pl-5 space-y-2">
                        {section.list.map((item, idx) => (
                          <li key={`${section.title}-li-${idx}`}>{item}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
            <div className="text-white/90 text-xl font-semibold">流程确认</div>
            <div className="text-white/70 text-sm leading-7">{FLOW_LINE}</div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/system/trial-access/confirm`)}
              className="inline-flex items-center rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/85 hover:bg-white/15"
            >
              确认流程
            </button>
          </section>
        </>
      ) : (
        <>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
            <div className="text-white/90 text-xl font-semibold">流程说明</div>
            <div className="text-white/70 text-sm leading-7">{FLOW_LINE}</div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
            <div className="text-white/90 text-xl font-semibold">沟通确认</div>
            <div className="text-white/70 text-sm leading-7">
              如果你已经理解三日体验边界，并完成资料申请、阅读和上传准备，可以通过咨询菜单联系团队长或助教进行下一步沟通确认。沟通只围绕软件使用、训练流程、资料审核和仿真任务安排，不涉及真实账户、实盘服务或收益承诺。
            </div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/system/consult`)}
              className="inline-flex items-center rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white/85 hover:bg-white/15"
            >
              我已了解流程：联系团队长
            </button>
          </section>
        </>
      )}
    </div>
  );
}
