"use client";
const ITEMS = [
  { href: "/app", label: "داشبورد" },
  { href: "/app/chat", label: "گفتگو" },
  { href: "/app/bills", label: "قبض‌ها" },
  { href: "/app/history", label: "تاریخچه" },
  { href: "/app/profile", label: "پروفایل" },
];
export function Sidebar() {
  return (
    <nav className="flex flex-col gap-1 p-3 border-s w-56 shrink-0">
      {ITEMS.map((i) => (
        <a key={i.href} href={i.href} className="rounded-md px-3 py-2 text-sm hover:bg-muted">
          {i.label}
        </a>
      ))}
    </nav>
  );
}
