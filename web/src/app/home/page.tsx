"use client";

// Dashboard route — the gated user app entry (mini-app button opens this).

import { SessionGate } from "@/components/SessionGate";
import { UserNav } from "@/lib/nav/UserNav";

export default function HomePage() {
  return <SessionGate>{() => <UserNav initial="home" />}</SessionGate>;
}
