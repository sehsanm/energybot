"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/login", { method: "POST", body: { email, password } });
      router.replace("/admin");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h1 className="text-lg font-black">پنل مدیریت دستیار انرژی</h1>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">ایمیل</span>
          <input
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold">گذرواژه</span>
          <input
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            required
          />
        </label>
        {error && <p className="text-xs text-[var(--warning)]">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 font-bold text-[var(--accent-fg)] disabled:opacity-50"
        >
          ورود
        </button>
      </form>
    </div>
  );
}
