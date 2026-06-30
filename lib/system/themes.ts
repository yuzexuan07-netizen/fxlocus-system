export const systemThemes = [
  { key: "nebula", zh: "星云", en: "Nebula" },
  { key: "midnight", zh: "深夜", en: "Midnight" },
  { key: "aurora", zh: "极光", en: "Aurora" },
  { key: "ember", zh: "余烬", en: "Ember" },
  { key: "jade", zh: "翡翠", en: "Jade" },
  { key: "dune", zh: "沙丘", en: "Dune" },
  { key: "arctic", zh: "极地", en: "Arctic" },
  { key: "ruby", zh: "红宝", en: "Ruby" },
  { key: "sapphire", zh: "蓝宝", en: "Sapphire" },
  { key: "emerald", zh: "翠绿", en: "Emerald" },
  { key: "amber", zh: "琥珀", en: "Amber" },
  { key: "tech", zh: "科技", en: "Tech" },
  { key: "onyx", zh: "黑曜", en: "Onyx" }
] as const;

export type SystemTheme = (typeof systemThemes)[number]["key"];

export function isSystemTheme(value: string): value is SystemTheme {
  return systemThemes.some((item) => item.key === value);
}

export function getDefaultSystemThemeForSiteTheme(siteTheme: string | null | undefined): SystemTheme {
  return siteTheme === "theme-2" ? "nebula" : "ember";
}
