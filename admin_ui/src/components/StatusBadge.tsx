import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Archive, FileText, AlertCircle } from "lucide-react";

const map: Record<string, { variant: any; label: string; icon: any }> = {
  active: { variant: "success", label: "فعال", icon: CheckCircle2 },
  published: { variant: "success", label: "منتشرشده", icon: CheckCircle2 },
  draft: { variant: "muted", label: "پیش‌نویس", icon: FileText },
  inactive: { variant: "muted", label: "غیرفعال", icon: Circle },
  archived: { variant: "warning", label: "بایگانی", icon: Archive },
  deleted: { variant: "destructive", label: "حذف‌شده", icon: AlertCircle },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = map[status] ?? { variant: "outline", label: status, icon: Circle };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant}>
      <Icon /> {cfg.label}
    </Badge>
  );
}

const categoryMap: Record<string, { variant: any; label: string }> = {
  electricity: { variant: "default", label: "برق" },
  gas: { variant: "warning", label: "گاز" },
  general: { variant: "muted", label: "عمومی" },
};

export function CategoryBadge({ category }: { category: string }) {
  const cfg = categoryMap[category] ?? { variant: "outline", label: category };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
