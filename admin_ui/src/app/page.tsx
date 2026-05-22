"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Index() {
  const r = useRouter();
  useEffect(() => { api.me().then(() => r.replace("/dashboard")).catch(() => r.replace("/login")); }, [r]);
  return null;
}
