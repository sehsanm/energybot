"use client";

// Rendered-markdown view for the KB subset (see lib/markdown).

import { parseMarkdown, type InlineSegment } from "@/lib/markdown";

function Inline({ segs }: { segs: InlineSegment[] }) {
  return (
    <>
      {segs.map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>))}
    </>
  );
}

export function MarkdownView({ md }: { md: string }) {
  const blocks = parseMarkdown(md);
  return (
    <div className="space-y-3 text-sm leading-7">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h1":
            return (
              <h2 key={i} className="border-b border-[var(--border)] pb-1 text-lg font-black">
                <Inline segs={b.inline} />
              </h2>
            );
          case "h2":
            return (
              <h3 key={i} className="pt-1 text-base font-black">
                <Inline segs={b.inline} />
              </h3>
            );
          case "h3":
            return (
              <h4 key={i} className="font-black">
                <Inline segs={b.inline} />
              </h4>
            );
          case "hr":
            return <hr key={i} className="border-[var(--border)]" />;
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1.5 pr-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline segs={it} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pr-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline segs={it} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i}>
                <Inline segs={b.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
