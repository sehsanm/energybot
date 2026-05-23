"use client";
import { useEffect, useState } from "react";

// Next.js `output: export` prerenders dynamic routes against a placeholder segment
// (`generateStaticParams() => [{ id: "_" }]`). The server SPA-fallback serves that
// placeholder HTML for real ids, but `useParams()` then keeps returning "_" because
// it reads from the frozen prerendered tree, not the live URL. Derive the id from
// `window.location.pathname` instead.
export function useUrlId(): string {
  const [id, setId] = useState<string>("");
  useEffect(() => {
    const segments = window.location.pathname.replace(/\/+$/, "").split("/");
    setId(decodeURIComponent(segments[segments.length - 1] || ""));
  }, []);
  return id;
}
