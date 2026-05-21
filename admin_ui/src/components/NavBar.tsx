"use client";
import Link from "next/link";
const links = [
  { href: "/dashboard", label: "داشبورد" },
  { href: "/users", label: "کاربران" },
  { href: "/chats", label: "گفتگوها" },
  { href: "/kb/articles", label: "دانش‌نامه" },
  { href: "/prompts", label: "پرامپت‌ها" },
  { href: "/models", label: "مدل‌ها" },
  { href: "/audit-log", label: "گزارش تغییرات" },
];
export function NavBar() {
  return (
    <nav className="bg-white shadow px-4 py-3 flex gap-4">
      {links.map(l => <Link key={l.href} href={l.href} className="hover:underline">{l.label}</Link>)}
    </nav>
  );
}
