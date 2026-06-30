"use client";
import { useEffect, useState } from "react";
import { BadgePercent, Plus, Trash2, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

const DEFAULT_PARAMS = JSON.stringify({
  free_tier: { summer: { pattern_kwh: 300, low_user_kwh: 200 }, winter: { pattern_kwh: 200, low_user_kwh: 120 } },
  savings_reward: { min_reduction_pct: 10, reward_pct_of_bill: 30, low_usage_threshold_kwh: 150, per_kwh_rial_reward: 5000, monthly_cap_rial: 8500000 },
  verified: false, last_verified: "1404",
}, null, 2);

export default function IncentivesPage() {
  const [params, setParams] = useState<any[] | null>(null);
  const [cities, setCities] = useState<any[] | null>(null);
  const [year, setYear] = useState("1404");
  const [zone, setZone] = useState("normal");
  const [label, setLabel] = useState("");
  const [paramsJson, setParamsJson] = useState(DEFAULT_PARAMS);
  const [active, setActive] = useState(true);
  const [paramErr, setParamErr] = useState("");
  const [savingP, setSavingP] = useState(false);

  const [cityName, setCityName] = useState("");
  const [province, setProvince] = useState("");
  const [cityZone, setCityZone] = useState("normal");
  const [savingC, setSavingC] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  async function load() {
    setLoadErr("");
    try {
      const [p, c] = await Promise.all([api.listIncentiveParams(), api.listCityZones()]);
      setParams(p.params);
      setCities(c.cities);
    } catch {
      setLoadErr("خطا در بارگذاری داده‌ها");
      setParams([]);   // break the skeleton
      setCities([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function createParam() {
    setParamErr("");
    let parsed: any;
    try { parsed = JSON.parse(paramsJson); }
    catch { setParamErr("JSON نامعتبر است"); return; }
    setSavingP(true);
    try {
      await api.createIncentiveParam({ effective_year: Number(year), climate_zone: zone, label, params: parsed, is_active: active });
      setLabel("");
      await load();
    } finally { setSavingP(false); }
  }

  async function toggleActive(row: any) {
    await api.updateIncentiveParam(row.id, { is_active: !row.is_active });
    await load();
  }

  async function removeParam(id: string) {
    await api.deleteIncentiveParam(id);
    await load();
  }

  async function createCity() {
    if (!cityName) return;
    setSavingC(true);
    try {
      await api.createCityZone({ city_name: cityName, province, climate_zone: cityZone });
      setCityName(""); setProvince("");
      await load();
    } finally { setSavingC(false); }
  }

  async function removeCity(id: string) {
    await api.deleteCityZone(id);
    await load();
  }

  return (
    <>
      <PageHeader
        title="مشوق‌ها و پاداش‌ها"
        description="پارامترهای طرح‌های توانیر (برق امید، پاداش صرفه‌جویی) به تفکیک سال و اقلیم، و نگاشت شهر به اقلیم. اعداد را با ارقام رسمی توانیر به‌روز نگه دارید."
      />

      <div className="space-y-6">
        {loadErr && <p className="text-sm text-destructive px-1">{loadErr}</p>}
        {/* Param sets */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /> مجموعهٔ پارامتر جدید</CardTitle>
              <CardDescription>برای هر سال و اقلیم یک مجموعه. فقط مجموعهٔ «فعال» در محاسبه استفاده می‌شود.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="year">سال</Label>
                  <Input id="year" value={year} onChange={e => setYear(e.target.value)} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zone">اقلیم</Label>
                  <Input id="zone" value={zone} onChange={e => setZone(e.target.value)} placeholder="normal / hot" className="font-mono" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label">برچسب</Label>
                <Input id="label" value={label} onChange={e => setLabel(e.target.value)} placeholder="مثل مناطق عادی ۱۴۰۴" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="params">پارامترها (JSON)</Label>
                <Textarea id="params" value={paramsJson} onChange={e => setParamsJson(e.target.value)} rows={12} className="font-mono text-xs leading-relaxed" />
                {paramErr && <p className="text-xs text-destructive">{paramErr}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> فعال
              </label>
              <Button onClick={createParam} disabled={savingP} className="w-full">
                {savingP ? "در حال ذخیره..." : "افزودن مجموعه"}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 p-0 overflow-hidden">
            <CardHeader>
              <CardTitle>مجموعه‌های پارامتر</CardTitle>
              <CardDescription>{params ? `${params.length.toLocaleString("fa-IR")} مجموعه` : "بارگذاری..."}</CardDescription>
            </CardHeader>
            {params === null ? (
              <div className="space-y-2 px-6 pb-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : params.length === 0 ? (
              <div className="px-6 pb-6"><EmptyState icon={BadgePercent} title="هنوز پارامتری ثبت نشده" description="اولین مجموعه را با فرم سمت راست بسازید." /></div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>سال</TableHead><TableHead>اقلیم</TableHead><TableHead>برچسب</TableHead>
                  <TableHead className="text-center">وضعیت</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {params.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums">{r.effective_year}</TableCell>
                      <TableCell className="font-mono text-sm">{r.climate_zone}</TableCell>
                      <TableCell className="text-sm">{r.label}{r.params?.verified === false && <Badge variant="outline" className="ms-2">تأییدنشده</Badge>}</TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant={r.is_active ? "success" : "outline"} onClick={() => toggleActive(r)}>
                          {r.is_active ? "فعال" : "غیرفعال"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button size="sm" variant="ghost" onClick={() => removeParam(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        {/* City zones */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> شهر → اقلیم</CardTitle>
              <CardDescription>برای تشخیص اقلیم کاربر از روی شهر پروفایل استفاده می‌شود.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="city">شهر</Label><Input id="city" value={cityName} onChange={e => setCityName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="prov">استان</Label><Input id="prov" value={province} onChange={e => setProvince(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="cz">اقلیم</Label><Input id="cz" value={cityZone} onChange={e => setCityZone(e.target.value)} placeholder="normal / hot" className="font-mono" /></div>
              <Button onClick={createCity} disabled={savingC || !cityName} className="w-full">{savingC ? "در حال ذخیره..." : "افزودن شهر"}</Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 p-0 overflow-hidden">
            <CardHeader>
              <CardTitle>شهرها</CardTitle>
              <CardDescription>{cities ? `${cities.length.toLocaleString("fa-IR")} شهر` : "بارگذاری..."}</CardDescription>
            </CardHeader>
            {cities === null ? (
              <div className="space-y-2 px-6 pb-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : cities.length === 0 ? (
              <div className="px-6 pb-6"><EmptyState icon={MapPin} title="هنوز شهری ثبت نشده" description="اولین شهر را با فرم سمت راست بسازید." /></div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>شهر</TableHead><TableHead>استان</TableHead><TableHead>اقلیم</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {cities.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{c.city_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.province}</TableCell>
                      <TableCell className="font-mono text-sm">{c.climate_zone}</TableCell>
                      <TableCell className="text-end"><Button size="sm" variant="ghost" onClick={() => removeCity(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
