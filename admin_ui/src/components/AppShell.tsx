"use client";
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, MobileSidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { api } from "@/lib/api";

type User = { id: string; email: string; role: string } | null;

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [user, setUser] = React.useState<User>(null);
  const [checked, setChecked] = React.useState(false);
  const isLogin = pathname === "/login";

  React.useEffect(() => {
    if (isLogin) {
      setChecked(true);
      return;
    }
    api.me()
      .then(u => setUser(u))
      .catch(() => router.replace("/login"))
      .finally(() => setChecked(true));
  }, [isLogin, router, pathname]);

  // close mobile drawer on route change
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (isLogin) {
    return <>{children}</>;
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} user={user} />
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  );
}
