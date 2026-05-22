import UserDetailClient from "./UserDetailClient";

export function generateStaticParams() { return [{ id: "_" }]; }

export default function UserDetailPage() { return <UserDetailClient />; }
