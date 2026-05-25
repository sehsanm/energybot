import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "انرژی‌بات — دستیار هوشمند صرفه‌جویی انرژی",
  description:
    "دستیار فارسی‌زبان صرفه‌جویی برق و گاز در پیام‌رسان بله. توصیه‌های شخصی‌سازی‌شده بر اساس پروفایل خانه‌ی شما.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('energybot-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
