"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function NewArticle() {
  const r = useRouter();
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [category, setCategory] = useState("general");
  async function save() {
    const { id } = await api.createArticle({ title, body, category, tags: [] });
    r.push(`/kb/articles/${id}`);
  }
  return (
    <><NavBar /><main className="p-6 max-w-3xl space-y-3">
      <label className="block">عنوان<input value={title} onChange={e => setTitle(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">متن<textarea value={body} onChange={e => setBody(e.target.value)} rows={12} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">دسته<select value={category} onChange={e => setCategory(e.target.value)} className="border p-2 rounded mt-1"><option value="electricity">برق</option><option value="gas">گاز</option><option value="general">عمومی</option></select></label>
      <button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded">ذخیره</button>
    </main></>
  );
}
