"use client";

// Hand-rolled admin charts (no dependency), following the dataviz method:
// thin marks, 2px surface gaps between fills, recessive grid, selective
// direct labels, legend + <title> tooltips. Palette pair is dataviz-validated
// per mode (--chart-bale/--chart-telegram); amber's light-mode contrast WARN
// is relieved by the visible legend values.

import { toFaDigits } from "@/components/kit/logic";

const CHANNEL_LABEL: Record<string, string> = { bale: "بله", telegram: "تلگرام" };
const CHANNEL_COLOR: Record<string, string> = {
  bale: "var(--chart-bale)",
  telegram: "var(--chart-telegram)",
};

/** Part-to-whole donut for the channel split; center carries the total. */
export function ChannelDonut({ data }: { data: { channel: string; n: number }[] }) {
  const total = data.reduce((a, d) => a + d.n, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex items-center gap-6" dir="ltr">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label="تقسیم کانال‌ها">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--secondary)" strokeWidth="16" />
        {total > 0 &&
          data.map((d) => {
            const frac = d.n / total;
            const seg = (
              <circle
                key={d.channel}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={CHANNEL_COLOR[d.channel] ?? "var(--chart-3, var(--chart-bale))"}
                strokeWidth="16"
                strokeDasharray={`${Math.max(frac * C - 2, 0)} ${C}`} // 2px surface gap
                strokeDashoffset={-offset * C}
                transform="rotate(-90 70 70)"
                strokeLinecap="butt"
              >
                <title>{`${CHANNEL_LABEL[d.channel] ?? d.channel}: ${toFaDigits(d.n)} (${toFaDigits(
                  Math.round(frac * 100),
                )}٪)`}</title>
              </circle>
            );
            offset += frac;
            return seg;
          })}
        <text x="70" y="66" textAnchor="middle" className="fill-[var(--foreground)] text-xl font-black">
          {toFaDigits(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" className="fill-[var(--muted-foreground)] text-[9px]">
          هویت کاربران
        </text>
      </svg>

      <ul className="space-y-2 text-xs" dir="rtl">
        {data.map((d) => (
          <li key={d.channel} className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 rounded-sm"
              style={{ backgroundColor: CHANNEL_COLOR[d.channel] ?? "var(--chart-bale)" }}
              aria-hidden
            />
            <span className="font-bold">{CHANNEL_LABEL[d.channel] ?? d.channel}</span>
            <span dir="ltr" className="text-[var(--muted-foreground)]">
              {toFaDigits(d.n)} · {toFaDigits(total ? Math.round((d.n / total) * 100) : 0)}٪
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 7-day daily message counts: single-series bars, LTR time axis. */
export function WeekBars({ data }: { data: { date: string; n: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const maxIdx = data.findIndex((d) => d.n === max);
  const H = 120;

  return (
    <div dir="ltr">
      <div className="relative" style={{ height: H + 24 }}>
        {/* recessive gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <div
            key={f}
            className="absolute inset-x-0 border-t border-[var(--border)]/60"
            style={{ bottom: 24 + f * (H - 8) }}
            aria-hidden
          />
        ))}
        <div className="absolute inset-x-0 bottom-6 flex h-[120px] items-end justify-between gap-1.5">
          {data.map((d, i) => {
            const h = Math.max((d.n / max) * (H - 8), d.n > 0 ? 4 : 2);
            const isMax = i === maxIdx && d.n > 0;
            return (
              <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                {isMax && (
                  <span className="text-[10px] font-black text-[var(--foreground)]" dir="ltr">
                    {toFaDigits(d.n)}
                  </span>
                )}
                <div
                  className="w-full rounded-t-[4px] transition-opacity hover:opacity-80"
                  style={{
                    height: h,
                    backgroundColor: d.n > 0 ? "var(--chart-bale)" : "var(--secondary)",
                  }}
                  title={`${d.date}: ${toFaDigits(d.n)}`}
                />
              </div>
            );
          })}
        </div>
        {/* day labels */}
        <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1.5">
          {data.map((d) => (
            <span key={d.date} className="flex-1 text-center text-[9px] text-[var(--muted-foreground)]" dir="ltr">
              {toFaDigits(Number(d.date.slice(8, 10)))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
