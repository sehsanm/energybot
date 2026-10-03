"use client";

// Hand-rolled CSS confetti (no dependency): deterministic burst from a seed,
// token colors, auto-clears, pointer-transparent, motion-safe (the global
// prefers-reduced-motion rule in globals.css neutralizes it).

import { useEffect, useMemo, useState } from "react";
import { confettiPieces } from "./logic";

export function Confetti({
  fire,
  seed = 1,
  count = 24,
}: {
  fire: boolean;
  seed?: number;
  count?: number;
}) {
  const pieces = useMemo(() => confettiPieces(seed, count), [seed, count]);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!fire) return;
    setBurst(true);
    const t = setTimeout(() => setBurst(false), 1800);
    return () => clearTimeout(t);
  }, [fire]);

  if (!burst) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`@keyframes kit-confetti-fall {
        0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
        100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
      }`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-[2px]"
          style={{
            left: `${p.leftPct}%`,
            width: `${p.sizePx}px`,
            height: `${p.sizePx * 1.6}px`,
            backgroundColor: p.color,
            animation: `kit-confetti-fall ${p.durationMs}ms ease-in ${p.delayMs}ms both`,
          }}
        />
      ))}
    </div>
  );
}
