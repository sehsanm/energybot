"use client";

// Courses route — thin wrapper; screen lives in components/screens.

import { SessionGate } from "@/components/SessionGate";
import { UserNav } from "@/lib/nav/UserNav";

export default function CoursesPage() {
  return <SessionGate>{() => <UserNav initial="courses" />}</SessionGate>;
}
