// Shared bill row → JSON serializer for API responses.

import type { schema } from "@/lib/db";
import { fmtAmountRial } from "@/lib/format";

const KIND_FA: Record<string, string> = { electricity: "برق", gas: "گاز", water: "آب" };

export function billToJson(b: typeof schema.bills.$inferSelect) {
  const details = JSON.parse(b.details ?? "{}");
  const suggestions = b.suggestions ? JSON.parse(b.suggestions) : null;
  return {
    id: b.id,
    billId: b.billId,
    utilityType: b.utilityType,
    utilityLabel: KIND_FA[b.utilityType] ?? b.utilityType,
    amountToman: Math.floor(b.amount / 10),
    amountLabel: fmtAmountRial(b.amount),
    term: b.term,
    dueDate: b.dueDate,
    consumption: b.consumption,
    details,
    suggestions,
    createdAt: b.createdAt,
  };
}
