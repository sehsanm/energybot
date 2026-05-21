"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function PromptsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [key, setKey] = useState(""); const [name, setName] = useState(""); const [body, setBody] = useState("");
  async function load() { const r = await api.listPrompts(); setRows(r.prompts); }
  useEffect(() => { load(); }, []);
  async function create() { await api.createPrompt({ key, name, body }); await load(); }
  return (
    <><NavBar /><main className="p-6 max-w-4xl space-y-3">
      <h1 className="text-xl font-bold">پرامپت‌ها</h1>
      <div className="bg-white p-4 rounded shadow space-y-2">
        <input placeholder="کلید (مثل system_prompt)" value={key} onChange={e => setKey(e.target.value)} className="border p-2 rounded w-full" />
        <input placeholder="نام" value={name} onChange={e => setName(e.target.value)} className="border p-2 rounded w-full" />
        <textarea placeholder="متن قالب (Jinja2)" value={body} onChange={e => setBody(e.target.value)} className="border p-2 rounded w-full" rows={8} />
        <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded">افزودن نسخه</button>
      </div>
      <table className="w-full bg-white shadow rounded mt-4">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">کلید</th><th className="p-2 text-right">نسخه</th><th className="p-2 text-right">وضعیت</th><th className="p-2 text-right"></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-t"><td className="p-2">{r.key}</td><td className="p-2">{r.version}</td><td className="p-2">{r.status}</td><td className="p-2">{r.status !== "active" && <button onClick={async () => { await api.activatePrompt(r.id); await load(); }} className="bg-green-600 text-white px-3 py-1 rounded">فعال‌سازی</button>}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
