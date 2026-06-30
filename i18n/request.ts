import { getRequestConfig } from "next-intl/server";
import { defaultLocale, locales } from "./routing";

type Locale = (typeof locales)[number];
type Messages = Record<string, unknown>;

const messageCache: Partial<Record<Locale, Messages>> = {};

async function loadMessages(locale: Locale) {
  if (messageCache[locale]) {
    return messageCache[locale];
  }

  const modules = locale === "zh"
    ? await Promise.all([
        import("../messages/zh/common.json"),
        import("../messages/zh/system.json"),
        import("../messages/zh/adminSystem.json")
      ])
    : await Promise.all([
        import("../messages/en/common.json"),
        import("../messages/en/system.json"),
        import("../messages/en/adminSystem.json")
      ]);

  const [
    common,
    system,
    adminSystem
  ] = modules;

  const messages: Messages = {
    common: common.default,
    system: system.default,
    adminSystem: adminSystem.default
  };

  messageCache[locale] = messages;
  return messages;
}

export default getRequestConfig(async ({ locale }) => {
  const resolvedLocale = locale && locales.includes(locale as Locale)
    ? (locale as Locale)
    : defaultLocale;

  return {
    locale: resolvedLocale,
    messages: await loadMessages(resolvedLocale)
  };
});
