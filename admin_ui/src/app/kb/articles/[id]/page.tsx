import ArticleEditClient from "./ArticleEditClient";

export function generateStaticParams() { return [{ id: "_" }]; }

export default function ArticleEditPage() { return <ArticleEditClient />; }
