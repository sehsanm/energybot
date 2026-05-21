"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.dashboard().then(setData); }, []);
  return (
    <>
      <NavBar />
      <main className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="کاربران فعال امروز" value={data?.dau ?? "..."} />
        <Card title="پیام‌های امروز" value={data?.messages_today ?? "..."} />
        <Card title="کل کاربران" value={data?.total_users ?? "..."} />
      </main>
    </>
  );
}
function Card({ title, value }: { title: string; value: any }) {
  return <div className="bg-white p-4 rounded shadow"><div className="text-sm text-gray-600">{title}</div><div className="text-2xl font-bold mt-2">{value}</div></div>;
}
