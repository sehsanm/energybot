"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

export default function NewArticle() {
  const r = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { id } = await api.createArticle({ title, body, category, tags: [] });
      r.push(`/kb/articles/${id}`);
    } finally { setSaving(false); }
  }

  return (
    <>
      <PageHeader
        title="مقالهٔ جدید"
        description="پس از ساخت، می‌توانید آن را ویرایش و سپس منتشر کنید."
        actions={
          <Button variant="outline" onClick={() => r.push("/kb/articles")}>
            <ArrowRight /> بازگشت
          </Button>
        }
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>اطلاعات مقاله</CardTitle>
          <CardDescription>عنوان، دسته و متن اولیه را وارد کنید. بعداً می‌توانید پیوست هم اضافه کنید.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">عنوان</Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="مثلاً: راهنمای کاهش مصرف برق" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">دسته</Label>
            <Select id="category" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="electricity">برق</option>
              <option value="gas">گاز</option>
              <option value="general">عمومی</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">متن</Label>
            <Textarea
              id="body"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={14}
              className="font-mono text-xs leading-relaxed"
              placeholder="محتوای مقاله را به Markdown بنویسید..."
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving || !title.trim()}>
              <Save /> {saving ? "در حال ذخیره..." : "ذخیره و ادامه"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
