import React from "react";

export const metadata = { title: "System" };

export default function SystemPublicLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { locale: "zh" | "en" };
}) {
  void params;

  return (
    <div className="system-public-shell min-h-screen w-full overflow-hidden bg-[color:var(--bg)]">
      <div className="system-public-content h-screen min-h-screen min-w-0">
        {children}
      </div>
    </div>
  );
}
