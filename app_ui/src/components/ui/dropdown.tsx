"use client";
import * as React from "react";
import { cn } from "@/lib/cn";

interface DropdownCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
}
const Ctx = React.createContext<DropdownCtx | null>(null);

export function Dropdown({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <Ctx.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative inline-block">
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function DropdownTrigger({ children }: { children: React.ReactElement }) {
  const ctx = React.useContext(Ctx)!;
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.setOpen(!ctx.open);
    children.props.onClick?.(e);
  };
  return React.cloneElement(children, { onClick, "aria-expanded": ctx.open });
}

export function DropdownContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const ctx = React.useContext(Ctx)!;
  if (!ctx.open) return null;
  return (
    <div
      role="menu"
      className={cn(
        "absolute top-full mt-2 min-w-[12rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg z-50 animate-fade-in",
        align === "end" ? "end-0" : "start-0",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DropdownItem({
  children,
  onSelect,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  variant?: "default" | "destructive";
  className?: string;
}) {
  const ctx = React.useContext(Ctx)!;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        ctx.setOpen(false);
        onSelect?.();
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm transition-colors",
        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        "[&_svg]:size-4 [&_svg]:text-muted-foreground",
        variant === "destructive" && "text-destructive hover:bg-destructive/10 [&_svg]:text-destructive",
        className
      )}
    >
      {children}
    </button>
  );
}

export function DropdownLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-2.5 py-1.5 text-xs text-muted-foreground", className)}>{children}</div>;
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
