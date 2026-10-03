"use client";

// Public landing (anonymous): value proposition, how-it-works, CTAs into the
// bots. Full Stitch retrofit lands with the redesign pass — this is the
// structural page so / is public and gated pages redirect here.

import Link from "next/link";
import { copy } from "@/content/copy";

const baleUrl = process.env.NEXT_PUBLIC_BALE_BOT_URL || "/login";
const telegramUrl = process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL || "/login";

export default function LandingPage() {
  return (
    <div data-page="landing" className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 py-10">
      <main className="flex flex-1 flex-col justify-center gap-8 text-center">
        <div className="space-y-3">
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-[var(--primary)] text-4xl text-[var(--primary-foreground)] shadow-xl shadow-[var(--primary)]/20">
            ⚡
          </div>
          <h1 className="text-3xl font-black leading-tight">{copy.landing.hero}</h1>
          <p className="text-sm leading-7 text-[var(--muted-foreground)]">{copy.landing.sub}</p>
        </div>

        <ol className="space-y-3">
          {copy.landing.steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-right"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--secondary)] text-sm font-black">
                {(i + 1).toLocaleString("fa-IR")}
              </span>
              <span>
                <span className="block font-bold">{s.title}</span>
                <span className="mt-1 block text-xs leading-6 text-[var(--muted-foreground)]">{s.desc}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="space-y-3">
          <a
            href={baleUrl}
            className="block w-full rounded-full bg-[var(--primary)] px-4 py-3.5 font-bold text-[var(--primary-foreground)]"
          >
            {copy.landing.ctaBale}
          </a>
          <a
            href={telegramUrl}
            className="block w-full rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 font-bold"
          >
            {copy.landing.ctaTelegram}
          </a>
          <Link href="/login" className="block pt-1 text-xs text-[var(--muted-foreground)] underline">
            {copy.landing.webLogin}
          </Link>
        </div>
      </main>

      <footer className="pt-6 text-center text-xs text-[var(--muted-foreground)]">{copy.landing.footer}</footer>
    </div>
  );
}
