"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ArticleEditClient() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<any>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.getArticle(id).then(setA); }, [id]);
  async function save() { await api.updateArticle(id, { title: a.title, body: a.body, category: a.category, tags: a.tags }); setMsg("ذخیره شد"); }
  async function publish() { await api.publishArticle(id); setMsg("منتشر شد"); const fresh = await api.getArticle(id); setA(fresh); }
  async function upload(f: File) {
    const fd = new FormData(); fd.append("file", f);
    await fetch(`/api/admin/kb/articles/${id}/attachments`, { method: "POST", credentials: "include", body: fd, headers: { "x-csrf": localStorage.getItem("csrf") || "" } as any });
  }
  if (!a) return <><NavBar /><main className="p-6">...</main></>;
  return (
    <><NavBar /><main className="p-6 max-w-3xl space-y-3">
      <label className="block">عنوان<input value={a.title} onChange={e => setA({ ...a, title: e.target.value })} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">متن<textarea value={a.body} onChange={e => setA({ ...a, body: e.target.value })} rows={12} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">دسته<select value={a.category} onChange={e => setA({ ...a, category: e.target.value })} className="border p-2 rounded mt-1"><option value="electricity">برق</option><option value="gas">گاز</option><option value="general">عمومی</option></select></label>
      <div><input type="file" onChange={e => e.target.files && upload(e.target.files[0])} /></div>
      <div className="flex gap-2"><button onClick={save} className="bg-gray-600 text-white px-4 py-2 rounded">ذخیره</button><button onClick={publish} className="bg-blue-600 text-white px-4 py-2 rounded">انتشار</button></div>
      {msg && <p className="text-green-600">{msg}</p>}
    </main></>
  );
}
