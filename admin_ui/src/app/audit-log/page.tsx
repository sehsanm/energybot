"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function AuditLogPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.auditLog().then(r => setRows(r.entries)); }, []);
  return (
    <><NavBar /><main className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-4">گزارش تغییرات</h1>
      <ul className="space-y-2">{rows.map(r => <li key={r.id} className="bg-white p-3 rounded shadow"><div className="text-sm text-gray-500">{r.created_at}</div><div>{r.action} → {r.entity_type}/{r.entity_id}</div></li>)}</ul>
    </main></>
  );
}
