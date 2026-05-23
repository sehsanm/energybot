"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Index() {
  const r = useRouter();
  useEffect(() => {
    api.me().then(() => r.replace("/dashboard")).catch(() => r.replace("/login"));
  }, [r]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}
