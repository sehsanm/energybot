import type { Metadata, Viewport } from "next";
import "./globals.css";
import { MiniAppProvider } from "@/lib/miniapp/useMiniApp";

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
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh antialiased">
        <MiniAppProvider>{children}</MiniAppProvider>
      </body>
    </html>
  );
}
