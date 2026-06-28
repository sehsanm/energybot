"use client";
import { useEffect, useState } from "react";
import { Home, Target, Handshake, Sparkles, Plus, X, AlertCircle, Brain } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { faNum } from "@/lib/format";
import {
  getProfile,
  patchProfile,
  addProfileItem,
  removeProfileItem,
  getMemory,
  type ProfileData,
  type MemoryGroup,
} from "@/lib/api";

// occupants is stored normalized to an int (e.g. "5+" -> 5); map back to the option label.
function fieldValue(p: ProfileData, key: string): string {
  const v = (p.household as Record<string, unknown>)[key];
  if (v == null) return "";
  if (key === "occupants") {
    const n = Number(v);
    return n >= 5 ? "5+" : String(n);
  }
  return String(v);
}

export default function ProfilePage() {
  const [p, setP] = useState<ProfileData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [commitText, setCommitText] = useState("");
  const [memory, setMemory] = useState<MemoryGroup[]>([]);

  useEffect(() => {
    getProfile().then(setP).catch(() => {});
    getMemory().then(setMemory).catch(() => {});
  }, []);

  if (!p) {
    return (
      <AppShell>
        <div className="space-y-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      </AppShell>
    );
  }

  async function save(path: string, value: string) {
    setErr(null);
    try {
      setP(await patchProfile(path, value));
    } catch {
      setErr("ذخیره نشد؛ مقدار نامعتبر است.");
      getProfile().then(setP).catch(() => {});
    }
  }

  const behaviourEntries = Object.entries(p.behaviour || {});

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">پروفایل</h1>
          <p className="text-sm text-muted-foreground">هرچه کامل‌تر، پیشنهادهای صرفه‌جویی دقیق‌تر</p>
        </header>

        {err && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {err}
          </div>
        )}

        {/* completeness */}
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">تکمیل پروفایل</span>
              <span className="tabular-nums text-muted-foreground">{faNum(p.completeness_score)}٪</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-l from-primary to-secondary transition-all"
                style={{ width: `${p.completeness_score}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* household */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-4 w-4 text-muted-foreground" />
              مشخصات خانه
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {p.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`field-${f.key}`}>{f.label}</Label>
                  {f.options ? (
                    <Select
                      id={`field-${f.key}`}
                      value={fieldValue(p, f.key)}
                      onChange={(e) => save(f.path, e.target.value)}
                    >
                      <option value="" disabled>
                        انتخاب کن…
                      </option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      id={`field-${f.key}`}
                      key={`${f.key}-${fieldValue(p, f.key)}`}
                      defaultValue={fieldValue(p, f.key)}
                      onBlur={(e) => {
                        if (e.target.value.trim()) save(f.path, e.target.value.trim());
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* goals & commitments */}
        <div className="grid gap-6 md:grid-cols-2">
          <ChipSection
            title="اهداف"
            icon={Target}
            items={p.goals}
            value={goalText}
            setValue={setGoalText}
            onAdd={async (t) => setP(await addProfileItem("goals", t))}
            onRemove={async (i) => setP(await removeProfileItem("goals", i))}
            empty="هنوز هدفی ثبت نشده"
            placeholder="افزودن هدف…"
          />
          <ChipSection
            title="تعهدها"
            icon={Handshake}
            items={p.commitments}
            value={commitText}
            setValue={setCommitText}
            onAdd={async (t) => setP(await addProfileItem("commitments", t))}
            onRemove={async (i) => setP(await removeProfileItem("commitments", i))}
            empty="هنوز تعهدی ثبت نشده"
            placeholder="افزودن تعهد…"
          />
        </div>

        {/* learned habits */}
        {behaviourEntries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                عادت‌ها
              </CardTitle>
              <CardDescription>به‌صورت خودکار از گفتگوها یاد گرفته شده</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 sm:grid-cols-2">
                {behaviourEntries.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        {/* what the assistant remembers */}
        {memory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-muted-foreground" />
                آنچه دستیار درباره‌ی شما به خاطر دارد
              </CardTitle>
              <CardDescription>به‌صورت خودکار از گفتگوها یاد گرفته شده</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {memory.map((g) => (
                <div key={g.key} className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{g.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {g.items.map((it) => (
                      <span key={it.id} className="inline-flex rounded-full bg-muted px-3 py-1 text-sm">
                        {it.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function ChipSection(props: {
  title: string;
  icon: typeof Target;
  items: string[];
  value: string;
  setValue: (s: string) => void;
  empty: string;
  placeholder: string;
  onAdd: (t: string) => Promise<void>;
  onRemove: (i: number) => Promise<void>;
}) {
  const Icon = props.icon;
  async function add() {
    const t = props.value.trim();
    if (!t) return;
    try {
      await props.onAdd(t);
      props.setValue("");
    } catch {
      /* keep typed text so the user can retry */
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{props.empty}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {props.items.map((it, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
              >
                {it}
                <button
                  onClick={() => props.onRemove(i).catch(() => {})}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={`حذف ${it}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={props.value}
            onChange={(e) => props.setValue(e.target.value)}
            placeholder={props.placeholder}
            className="flex-1"
          />
          <Button type="submit" variant="outline" disabled={!props.value.trim()}>
            <Plus className="h-4 w-4" />
            افزودن
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
