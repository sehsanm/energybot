import { LayoutDashboard, MessagesSquare, ReceiptText, History, User, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

// hrefs are relative to the Next basePath (/app); next/link prepends it.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "داشبورد", icon: LayoutDashboard },
  { href: "/chat", label: "گفتگو", icon: MessagesSquare },
  { href: "/bills", label: "قبض‌ها", icon: ReceiptText },
  { href: "/history", label: "تاریخچه", icon: History },
  { href: "/profile", label: "پروفایل", icon: User },
];

// usePathname() excludes basePath; trailingSlash export can append "/".
export const normPath = (p: string) => (p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p);
