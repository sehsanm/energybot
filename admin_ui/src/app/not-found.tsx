"use client";
import { useEffect } from "react";

// This renders as 404.html; FastAPI serves it for unmatched /admin/* paths.
// The client-side Next.js router handles navigation from here.
export default function NotFound() {
  useEffect(() => {
    // no-op: Next.js router will hydrate and handle the route
  }, []);
  return null;
}
