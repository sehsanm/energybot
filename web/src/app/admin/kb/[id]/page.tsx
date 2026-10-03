"use client";

// Admin KB article editor: title/category/tags/body + status; saving re-chunks
// and re-indexes the article.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/client/api";

interface Article {
  id: string;
  slug: string;
  title: string;
  bodyMd: string;
  category: string;
  tags: string[];
  status: string;
}

export default function AdminKbEditPage() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<Article | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ article: Article }>(`/api/admin/kb/${id}`)
      .then((d) => setA(d.article))
      .catch((e) => setStatus((e as Error).message));
  }, [id]);

  async function save() {
    if (!a) return;
    setBusy(true);
    setStatus(null);
    try {
      await api("/api/admin/kb", {
        method: "PUT",
        body: {
          id: a.id,
          title: a.title,
          bodyMd: a.bodyMd,
          category: a.category,
          tags: a.tags,
          status: a.status as "draft" | "published",
        },
      });
      setStatus("ذخیره و ایندکس شد ✅");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!a) return <div className="p-8 text-center text-sm">{status ?? "…در حال بارگذاری"}</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">ویرایش مقاله</h1>
        <Link href="/admin/kb" className="text-sm font-bold text-[var(--accent)]">فهرست</Link>
      </div>
      <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <label className="block text-sm">
          <span className="mb-1 block font-bold">عنوان</span>
          <input
            value={a.title}
            onChange={(e) => setA({ ...a, title: e.target.value })}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-bold">دسته</span>
            <input
              value={a.category}
              onChange={(e) => setA({ ...a, category: e.target.value })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-bold">برچسب‌ها (با کاما)</span>
            <input
              value={a.tags.join(", ")}
              onChange={(e) => setA({ ...a, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-bold">متن (Markdown)</span>
          <textarea
            value={a.bodyMd}
            onChange={(e) => setA({ ...a, bodyMd: e.target.value })}
            rows={18}
            dir="rtl"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-6 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={a.status === "published"}
            onChange={(e) => setA({ ...a, status: e.target.checked ? "published" : "draft" })}
          />
          منتشرشده (در جستجوی چت هست)
        </label>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-fg)] disabled:opacity-50"
        >
          ذخیره و ایندکس
        </button>
        {status && <p className="text-xs text-[var(--muted)]">{status}</p>}
      </div>
    </div>
  );
}
