"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ArticlesList() {
  const [arts, setArts] = useState<any[]>([]);
  useEffect(() => { api.listArticles().then(d => setArts(d.articles)); }, []);
  return (
    <><NavBar /><main className="p-6">
      <div className="flex justify-between mb-4"><h1 className="text-xl font-bold">مقاله‌ها</h1><Link href="/kb/articles/new" className="bg-blue-600 text-white px-3 py-1 rounded">جدید</Link></div>
      <table className="w-full bg-white shadow rounded">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">عنوان</th><th className="p-2 text-right">دسته</th><th className="p-2 text-right">وضعیت</th><th className="p-2 text-right">نسخه</th></tr></thead>
        <tbody>{arts.map(a => <tr key={a.id} className="border-t"><td className="p-2"><Link href={`/kb/articles/${a.id}`}>{a.title}</Link></td><td className="p-2">{a.category}</td><td className="p-2">{a.status}</td><td className="p-2">{a.version}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
