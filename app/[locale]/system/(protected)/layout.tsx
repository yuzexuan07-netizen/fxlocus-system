import React from "react";
import { unstable_noStore } from "next/cache";
import { cookies } from "next/headers";

import { requireSystemUser } from "@/lib/system/auth";
import { isMobileAppRequest } from "@/lib/system/mobileApp";
import { isLearnerRole } from "@/lib/system/roles";
import { BfcacheGuard } from "@/components/system/BfcacheGuard";
import { MobileStudentPrimaryShell } from "@/components/system/MobileStudentPrimaryShell";
import { MobileStudentNav } from "@/components/system/MobileStudentNav";
import { Sidebar } from "@/components/system/Sidebar";
import { Topbar } from "@/components/system/Topbar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SystemProtectedLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: "zh" | "en" };
}) {
  unstable_noStore();
  const locale = params.locale === "en" ? "en" : "zh";
  const user = await requireSystemUser(locale);
  const initialSidebarCollapsed = cookies().get("fxlocus_system_sidebar_collapsed")?.value === "1";
  const mobilePrimaryRoles = new Set(["leader", "assistant", "super_admin"]);
  const isMobilePrimaryUser = isLearnerRole(user.role) || mobilePrimaryRoles.has(String(user.role));
  const useMobilePrimaryApp = isMobileAppRequest() && isMobilePrimaryUser;

  return (
    <div className="fixed left-0 right-0 bottom-0 top-0">
      <BfcacheGuard locale={locale} />
      <div className="system-shell flex h-full w-full">
        <Sidebar
          locale={locale}
          user={user}
          forceMobileApp={useMobilePrimaryApp}
          initialCollapsed={initialSidebarCollapsed}
        />
        <main className="system-main relative flex-1 min-w-0 h-full flex flex-col overflow-visible fx-galaxy-bg">
          <Topbar
            locale={locale}
            user={{ full_name: user.full_name, role: user.role }}
            forceMobileApp={useMobilePrimaryApp}
          />
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="system-content min-h-full w-full p-[var(--system-content-padding)]">
              {isMobilePrimaryUser ? (
                <MobileStudentPrimaryShell
                  locale={locale}
                  user={user}
                  serverMobileApp={useMobilePrimaryApp}
                >
                  {children}
                </MobileStudentPrimaryShell>
              ) : (
                children
              )}
            </div>
          </div>
        </main>
      </div>
      <MobileStudentNav
        locale={locale}
        user={{ role: user.role, student_status: user.student_status }}
        forceMobileApp={useMobilePrimaryApp}
      />
    </div>
  );
}

