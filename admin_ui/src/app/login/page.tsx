"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await api.login(email, password); r.replace("/dashboard"); }
    catch { setErr("ایمیل یا رمز عبور نادرست است."); }
  }
  return (
    <main className="flex items-center justify-center min-h-screen">
      <form onSubmit={submit} className="bg-white p-6 rounded shadow w-full max-w-md space-y-4">
        <h1 className="text-xl font-bold">ورود</h1>
        <label className="block">ایمیل<input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
        <label className="block">رمز عبور<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button className="w-full bg-blue-600 text-white rounded p-2">ورود</button>
      </form>
    </main>
  );
}
