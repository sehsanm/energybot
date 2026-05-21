"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function UserDetailClient() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.getUser(id).then(setData); }, [id]);
  if (!data) return <><NavBar /><main className="p-6">در حال بارگذاری...</main></>;
  return (
    <><NavBar /><main className="p-6 space-y-4">
      <h1 className="text-xl font-bold">{data.user.display_name || data.user.bale_user_id}</h1>
      <section><h2 className="font-bold mb-2">پروفایل</h2><pre className="bg-white p-3 rounded shadow text-sm">{JSON.stringify(data.profile, null, 2)}</pre></section>
      <section><h2 className="font-bold mb-2">جلسه‌های اخیر</h2><ul>{data.sessions.map((s: any) => <li key={s.id}><a href={`/admin/chats/${s.id}`}>{s.started_at}</a></li>)}</ul></section>
    </main></>
  );
}
