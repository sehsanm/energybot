"use client";
import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "energybot-theme";

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const stored = (localStorage.getItem(KEY) as "light" | "dark" | null) ?? null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: "light" | "dark" = stored ?? (prefersDark ? "dark" : "light");
    apply(initial);
    setTheme(initial);
  }, []);

  function apply(next: "light" | "dark") {
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(KEY, next);
  }

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="تغییر تم">
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
