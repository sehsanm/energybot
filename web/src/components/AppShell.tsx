"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "خانه", icon: "🏠" },
  { href: "/bills", label: "قبض‌ها", icon: "📄" },
  { href: "/profile", label: "پروفایل", icon: "👤" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-[var(--bg)]">
      <main className="flex-1 px-4 pb-24 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-lg items-stretch justify-around">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
                  active ? "font-bold text-[var(--accent)]" : "text-[var(--muted)]"
                }`}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean },
) {
  const { loading, ...rest } = props;
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 font-bold text-[var(--accent-fg)] transition-opacity disabled:opacity-50"
    />
  );
}
