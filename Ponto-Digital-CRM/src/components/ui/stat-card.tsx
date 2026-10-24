import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, cn } from ".";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  accent = "brand",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  trend?: number | null;
  accent?: "brand" | "coral" | "green" | "sky";
}) {
  const ring = {
    brand: "bg-brand-50 text-brand-600",
    coral: "bg-coral-50 text-coral-600",
    green: "bg-emerald-50 text-emerald-600",
    sky: "bg-sky-50 text-sky-600",
  }[accent];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <span className={cn("flex size-9 items-center justify-center rounded-xl", ring)}>
          <Icon className="size-[18px]" />
        </span>
      </div>
      <p className="mt-2 text-[26px] font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-[12.5px]">
        {trend != null && Number.isFinite(trend) && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", trend >= 0 ? "text-emerald-600" : "text-red-600")}>
            {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {Math.abs(trend).toFixed(0)}%
          </span>
        )}
        {hint && <span className="text-slate-500">{hint}</span>}
      </div>
    </Card>
  );
}
