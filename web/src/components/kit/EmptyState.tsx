"use client";

// Celebratory empty state: friendly icon + title + description + action slot.

export function EmptyState({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center shadow-sm">
      <div className="grid size-16 place-items-center rounded-full bg-[var(--secondary)] text-3xl">
        {icon}
      </div>
      <div className="space-y-1">
        <div className="font-black">{title}</div>
        {desc && <p className="text-xs leading-6 text-[var(--muted-foreground)]">{desc}</p>}
      </div>
      {children && <div className="w-full pt-1">{children}</div>}
    </div>
  );
}
