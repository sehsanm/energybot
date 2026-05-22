"use client";
import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function SearchTest() {
  const [q, setQ] = useState(""); const [hits, setHits] = useState<any[]>([]);
  async function go() { const r = await api.searchKB(q); setHits(r.hits); }
  return (
    <><NavBar /><main className="p-6 max-w-3xl space-y-3">
      <label className="block">جستجو<input value={q} onChange={e => setQ(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
      <button onClick={go} className="bg-blue-600 text-white px-4 py-2 rounded">جستجو</button>
      <ul className="mt-4 space-y-2">{hits.map(h => <li key={h.chunk_id} className="bg-white p-3 rounded shadow"><div className="text-sm text-gray-500">{h.article_title} — {h.relevance.toFixed(3)}</div><div className="mt-1 text-sm">{h.chunk_text}</div></li>)}</ul>
    </main></>
  );
}
