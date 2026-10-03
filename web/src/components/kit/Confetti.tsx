"use client";

// Hand-rolled CSS confetti (no dependency): deterministic burst from a seed,
// token colors, auto-clears, pointer-transparent, motion-safe (the global
// prefers-reduced-motion rule in globals.css neutralizes it).

import { useEffect, useMemo, useState } from "react";
import { confettiPieces } from "./logic";

export function Confetti({ burst, count = 24 }: { burst: number; count?: number }) {
  // One deterministic burst per increment — repeated completions re-fire.
  const pieces = useMemo(() => confettiPieces(burst, count), [burst, count]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (burst <= 0) return;
    setLive(true);
    const t = setTimeout(() => setLive(false), 1800);
    return () => clearTimeout(t);
  }, [burst]);

  if (!live) return null;

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
