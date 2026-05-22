"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ChatDetailClient() {
  const { id } = useParams<{ id: string }>();
  const [msgs, setMsgs] = useState<any[]>([]);
  useEffect(() => { api.getChat(id).then(d => setMsgs(d.messages)); }, [id]);
  return (
    <><NavBar /><main className="p-6 space-y-2 max-w-3xl">
      {msgs.map(m => (
        <div key={m.id} className="bg-white p-3 rounded shadow">
          <div className="text-xs text-gray-500">{m.role} — {m.created_at}</div>
          <div className="mt-1 whitespace-pre-wrap">{m.content || "—"}</div>
          {m.tool_name && <pre className="text-xs bg-gray-50 p-2 mt-2 rounded">{m.tool_name}({JSON.stringify(m.tool_args)}) → {JSON.stringify(m.tool_result)}</pre>}
        </div>
      ))}
    </main></>
  );
}
