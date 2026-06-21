"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { faNum } from "@/lib/format";

type Point = { term: string; consumption: number };

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-elevated">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <div className="text-muted-foreground">
        مصرف: <span className="font-semibold text-foreground tabular-nums">{faNum(payload[0].value)}</span>
      </div>
    </div>
  );
}

export function ConsumptionChart({ data, height = 260 }: { data: Point[]; height?: number }) {
  return (
    <div style={{ width: "100%", height }} dir="ltr">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="consGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" vertical={false} />
          <XAxis
            dataKey="term"
            reversed
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            orientation="right"
            width={48}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => faNum(v)}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "hsl(var(--chart-1))", strokeOpacity: 0.25 }} />
          <Area
            type="monotone"
            dataKey="consumption"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2.5}
            fill="url(#consGrad)"
            dot={{ r: 3, fill: "hsl(var(--chart-1))", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
