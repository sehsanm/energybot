"use client";

// Floating pill bottom navigation (Stitch style): rounded-full card floating
// above the safe area. Dual-mode like AppShell: embedded webviews navigate
// the memory stack; browsers use real routes.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Home, MessageCircle, Receipt, User } from "lucide-react";
import { useUserNav } from "@/lib/nav/UserNav";
import { USER_SCREENS } from "@/lib/nav/userNav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home,
  courses: GraduationCap,
  chat: MessageCircle,
  bills: Receipt,
  profile: User,
};

export function BottomNav() {
  const pathname = usePathname();
  const { screen, embedded, go } = useUserNav();

  return (
    <nav className="fixed inset-x-4 bottom-4 z-20 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-md items-stretch justify-around gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-lg shadow-black/5">
        {USER_SCREENS.map((item) => {
          const Icon = ICONS[item.key] ?? Home;
          const active = embedded ? screen === item.key : pathname === item.href;
          const cls = cn(
            "flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 text-[10px] font-bold transition-colors",
            active
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "text-[var(--muted-foreground)]",
          );
          return embedded ? (
            <button key={item.key} type="button" onClick={() => go(item.key)} className={cls}>
              <Icon className="size-5" aria-hidden />
              {item.label}
            </button>
          ) : (
            <Link key={item.key} href={item.href} className={cls}>
              <Icon className="size-5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
