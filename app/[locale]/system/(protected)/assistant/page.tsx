import { unstable_noStore } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AssistantEntry({ params }: { params: { locale: "zh" | "en" } }) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  redirect(`/${locale}/system/assistant/students`);
}
