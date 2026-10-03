"use client";

// Mini-app host integration: detects Telegram / Bale WebApp (or plain browser)
// once at launch, maps themeParams onto CSS variables, and exposes one
// `useMiniApp()` hook. Auth exchange happens in MiniAppGate before content.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type MiniAppHost = "telegram" | "bale" | "browser";

interface WebAppLike {
  initData?: string;
  platform?: string;
  colorScheme?: string;
  themeParams?: Record<string, string>;
  ready?: () => void;
  expand?: () => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: string) => void;
    notificationOccurred?: (type: string) => void;
  };
  BackButton?: { show?: () => void; hide?: () => void; onClick?: (cb: () => void) => void };
}

export interface MiniAppContextValue {
  host: MiniAppHost;
  webApp: WebAppLike | null;
  colorScheme: "light" | "dark";
  ready: boolean;
}

const MiniAppContext = createContext<MiniAppContextValue>({
  host: "browser",
  webApp: null,
  colorScheme: "light",
  ready: false,
});

export function useMiniApp(): MiniAppContextValue {
  return useContext(MiniAppContext);
}

/** Wire the host BackButton (both hosts); no-op in a plain browser. */
export function useBackButton(onClick: () => void, opts: { visible?: boolean } = {}): void {
  const { webApp, ready } = useMiniApp();
  useEffect(() => {
    if (!ready || !webApp?.BackButton) return;
    const bb = webApp.BackButton;
    bb.onClick?.(onClick);
    if (opts.visible !== false) bb.show?.();
    else bb.hide?.();
    return () => bb.hide?.();
  }, [ready, webApp, onClick, opts.visible]);
}

function detectHost(): { host: MiniAppHost; webApp: WebAppLike | null } {
  if (typeof window === "undefined") return { host: "browser", webApp: null };
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.initData !== undefined) return { host: "telegram", webApp: tg as WebAppLike };
  const bale = (window as any).Bale?.WebApp;
  if (bale?.initData !== undefined) return { host: "bale", webApp: bale as WebAppLike };
  return { host: "browser", webApp: null };
}

function applyTheme(webApp: WebAppLike | null, scheme: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", scheme === "dark");
  const tp = webApp?.themeParams;
  if (!tp) return;
  const map: [string, string][] = [
    ["--bg", tp.bg_color ?? ""],
    ["--surface", tp.secondary_bg_color ?? tp.bg_color ?? ""],
    ["--fg", tp.text_color ?? ""],
    ["--muted", tp.hint_color ?? ""],
    ["--accent", tp.button_color ?? ""],
    ["--accent-fg", tp.button_text_color ?? ""],
    ["--border", tp.secondary_bg_color ?? ""],
  ];
  for (const [cssVar, value] of map) if (value) root.style.setProperty(cssVar, value);
}

export function MiniAppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MiniAppContextValue>({
    host: "browser",
    webApp: null,
    colorScheme: "light",
    ready: false,
  });

  useEffect(() => {
    const { host, webApp } = detectHost();
    const colorScheme: "light" | "dark" =
      webApp?.colorScheme === "dark" ||
      (!webApp && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
    applyTheme(webApp, colorScheme);
    try {
      webApp?.ready?.();
      webApp?.expand?.();
    } catch {
      /* best-effort */
    }
    setState({ host, webApp, colorScheme, ready: true });
  }, []);

  const value = useMemo(() => state, [state]);
  return <MiniAppContext.Provider value={value}>{children}</MiniAppContext.Provider>;
}

/** Telegram-only haptics; no-op on Bale/browser. */
export function hapticImpact(webApp: WebAppLike | null, style = "light"): void {
  try {
    webApp?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    /* no-op */
  }
}
