"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ModelsPage() {
  const [rows, setRows] = useState<any[]>([]);
  async function load() { const r = await api.listModels(); setRows(r.models); }
  useEffect(() => { load(); }, []);
  return (
    <><NavBar /><main className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-4">مدل‌ها</h1>
      <table className="w-full bg-white shadow rounded">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">نوع تماس</th><th className="p-2 text-right">ارائه‌دهنده</th><th className="p-2 text-right">مدل</th><th className="p-2 text-right">فعال؟</th><th className="p-2 text-right"></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-t"><td className="p-2">{r.call_type}</td><td className="p-2">{r.provider}</td><td className="p-2">{r.model_name}</td><td className="p-2">{r.is_active ? "✔" : "—"}</td><td className="p-2">{!r.is_active && <button onClick={async () => { await api.activateModel(r.id); await load(); }} className="bg-green-600 text-white px-3 py-1 rounded">فعال‌سازی</button>}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
