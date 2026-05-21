"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { api.listUsers().then(d => setUsers(d.users)); }, []);
  return (
    <><NavBar /><main className="p-6"><h1 className="text-xl font-bold mb-4">کاربران</h1>
      <table className="w-full bg-white shadow rounded">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">نام</th><th className="p-2 text-right">شناسه بله</th><th className="p-2 text-right">آخرین فعالیت</th></tr></thead>
        <tbody>{users.map(u => <tr key={u.id} className="border-t"><td className="p-2"><Link href={`/users/${u.id}`}>{u.display_name || "—"}</Link></td><td className="p-2">{u.bale_user_id}</td><td className="p-2">{u.last_seen_at?.slice(0, 16) || "—"}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
