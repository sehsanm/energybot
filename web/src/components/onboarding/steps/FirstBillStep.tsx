"use client";

// Step 6 — skippable inline bill capture (spec §3): same payloads as
// BillsScreen (POST /api/bills with { text } or FormData file). The step has
// no wizard fields of its own (always valid, nothing to PUT): a successful
// capture shows the stored bill's mini-summary and auto-advances, and
// «فعلاً رد کن» skips ahead — both just call the wizard's onDone.

import { useEffect, useRef, useState } from "react";
import { Camera, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { copy } from "@/content/copy";
import { api } from "@/lib/client/api";
import type { StepProps } from "../WelcomeWizard";

/** Stored-bill fields the mini-summary shows (subset of the bills API's BillJson). */
interface CapturedBill {
  utilityLabel: string;
  amountLabel: string;
}

/** Success lingers just long enough to read the amounts before advancing. */
const AUTO_ADVANCE_MS = 1200;

export function FirstBillStep({ onDone }: StepProps & { onDone: () => void }) {
  const w = copy.onboardingWizard.firstBill;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<CapturedBill | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The auto-advance timer must never fire after this step unmounts (the
  // footer «ادامه» also advances) or twice (skip racing the timer).
  const timerRef = useRef<number | null>(null);
  const advancedRef = useRef(false);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function advance() {
    if (advancedRef.current) return;
    advancedRef.current = true;
    onDone();
  }

  /** Shared POST /api/bills path: on success show the summary + auto-advance. */
  async function capture(req: { body?: unknown; formData?: FormData }): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ bill: CapturedBill }>("/api/bills", { method: "POST", ...req });
      setBill(d.bill);
      setText("");
      timerRef.current = window.setTimeout(advance, AUTO_ADVANCE_MS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function uploadText() {
    if (!text.trim()) return;
    void capture({ body: { text: text.trim() } });
  }

  function uploadFile(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    void capture({ formData: fd });
  }

  // Success mini-summary — the bill card vocabulary of BillsScreen.
  if (bill) {
    return (
      <div className="space-y-4 pt-2">
        <Card>
          <CardContent className="px-4 py-1 text-center">
            <div className="font-black">
              📄 {w.billLabel} {bill.utilityLabel}
            </div>
            <div className="mt-1 text-2xl font-black">{bill.amountLabel}</div>
            <p className="mt-2 text-xs leading-6 text-[var(--muted-foreground)]">{w.advancingHint}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm font-bold leading-7">{w.prompt}</p>
      <Card className="bg-[var(--secondary)]/60">
        <CardContent className="space-y-3 px-4">
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={w.inputPlaceholder}
              inputMode="numeric"
              className="h-11 rounded-2xl bg-[var(--card)] text-left"
            />
            <Button
              className="h-11 shrink-0 rounded-2xl px-4 font-black"
              onClick={uploadText}
              disabled={busy || !text.trim()}
            >
              <Keyboard className="size-4" aria-hidden />
              {w.queryBtn}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
            <span className="h-px flex-1 bg-[var(--border)]" /> {w.orDivider}{" "}
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <Button
            variant="secondary"
            className="h-11 w-full rounded-2xl font-black"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Camera className="size-4" aria-hidden />
            {w.fileBtn}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
              e.target.value = "";
            }}
          />
          {error && <p className="text-xs text-[var(--warning)]">{error}</p>}
        </CardContent>
      </Card>
      <Button variant="outline" className="h-11 w-full rounded-2xl font-bold" onClick={advance}>
        {w.skipBtn}
      </Button>
    </div>
  );
}
