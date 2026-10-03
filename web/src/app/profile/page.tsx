"use client";

// Profile route — thin wrapper; screen lives in components/screens.

import { SessionGate } from "@/components/SessionGate";
import { UserNav } from "@/lib/nav/UserNav";

export default function ProfilePage() {
  return <SessionGate>{() => <UserNav initial="profile" />}</SessionGate>;
}
