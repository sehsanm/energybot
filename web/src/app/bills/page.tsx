"use client";

// Bills route — thin wrapper; screen lives in components/screens.

import { SessionGate } from "@/components/SessionGate";
import { UserNav } from "@/lib/nav/UserNav";

export default function BillsPage() {
  return <SessionGate>{() => <UserNav initial="bills" />}</SessionGate>;
}
