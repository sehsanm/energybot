"use client";

// Chat route — thin wrapper; screen lives in components/screens.

import { SessionGate } from "@/components/SessionGate";
import { UserNav } from "@/lib/nav/UserNav";

export default function ChatPage() {
  return <SessionGate>{() => <UserNav initial="chat" />}</SessionGate>;
}
