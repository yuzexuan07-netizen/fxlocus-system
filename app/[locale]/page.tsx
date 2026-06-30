import { redirect } from "next/navigation";

export default function LocaleHomePage({ params }: { params: { locale: "zh" | "en" } }) {
  const locale = params.locale === "en" ? "en" : "zh";
  redirect(`/${locale}/system`);
}
