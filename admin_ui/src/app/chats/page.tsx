"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ChatsPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.listChats().then(d => setRows(d.sessions)); }, []);
  return (
    <><NavBar /><main className="p-6"><h1 className="text-xl font-bold mb-4">گفتگوها</h1>
      <ul>{rows.map(s => <li key={s.id}><Link href={`/chats/${s.id}`}>{s.started_at} — {s.user_id}</Link></li>)}</ul>
    </main></>
  );
}
