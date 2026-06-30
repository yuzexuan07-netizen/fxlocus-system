export type MobileWebOnlyMenuId =
  | "dashboard"
  | "trial-access"
  | "courses"
  | "uploads"
  | "files"
  | "trade-logs"
  | "trade-strategies"
  | "classic-trades"
  | "weekly-summaries"
  | "today-data"
  | "ladder"
  | "store";

export type MobileWebOnlyMenuMeta = {
  id: MobileWebOnlyMenuId;
  zh: string;
  en: string;
};

export const MOBILE_WEB_ONLY_MENU_MAP: Record<MobileWebOnlyMenuId, MobileWebOnlyMenuMeta> = {
  dashboard: { id: "dashboard", zh: "仪表盘", en: "Dashboard" },
  "trial-access": { id: "trial-access", zh: "系统接入：三日体验", en: "System Access: 3-day Trial" },
  courses: { id: "courses", zh: "课程", en: "Courses" },
  uploads: { id: "uploads", zh: "资料上传", en: "Uploads" },
  files: { id: "files", zh: "文件", en: "Files" },
  "trade-logs": { id: "trade-logs", zh: "模拟交易日志", en: "Simulation Trade Logs" },
  "trade-strategies": { id: "trade-strategies", zh: "模拟交易策略", en: "Simulation Trade Strategies" },
  "classic-trades": { id: "classic-trades", zh: "模拟交易案例", en: "Simulation Trade Cases" },
  "weekly-summaries": { id: "weekly-summaries", zh: "周总结", en: "Weekly Summary" },
  "today-data": { id: "today-data", zh: "经济数据", en: "Economic Data" },
  ladder: { id: "ladder", zh: "天梯", en: "Ladder" },
  store: { id: "store", zh: "商城", en: "Store" }
};

export function getMobileWebOnlyMenuMeta(id: string | null | undefined) {
  const key = String(id || "").trim() as MobileWebOnlyMenuId;
  return MOBILE_WEB_ONLY_MENU_MAP[key] || null;
}
