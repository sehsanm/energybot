import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { MiniAppProvider } from "@/lib/miniapp/useMiniApp";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "دستیار انرژی",
  description: "دستیار صرفه‌جویی انرژی — قبضت را تحلیل کن، مصرف را کم کن",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={cn("font-sans", geist.variable)}>
      <body className="min-h-dvh antialiased">
        {/* Mini-app host bridges: the page must load these itself — hosts do not
            inject them. Telegram defines window.Telegram.WebApp, Bale window.Bale.WebApp.
            Unconditional loading is safe: detection treats a present-but-idle
            global (empty initData) as "browser". */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <Script src="https://tapi.bale.ai/miniapp.js" strategy="beforeInteractive" />
        <MiniAppProvider>{children}</MiniAppProvider>
      </body>
    </html>
  );
}
