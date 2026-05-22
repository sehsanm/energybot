import ChatDetailClient from "./ChatDetailClient";

export function generateStaticParams() { return [{ id: "_" }]; }

export default function ChatDetailPage() { return <ChatDetailClient />; }
