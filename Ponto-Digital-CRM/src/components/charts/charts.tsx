"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, moneyCompact } from "@/lib/format";

export function SalesChart({ data }: { data: { month: string; value: number; deals: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6e4ff6" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#6e4ff6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eef0f5" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            tickFormatter={(v: number) => moneyCompact(v)}
          />
          <Tooltip
            cursor={{ stroke: "#d4ccff" }}
            contentStyle={{ borderRadius: 12, border: "1px solid #e6e8f0", fontSize: 13 }}
            formatter={(v) => [money(Number(v)), "Vendas"]}
          />
          <Area type="monotone" dataKey="value" stroke="#5a3be4" strokeWidth={2.5} fill="url(#sales)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const FUNNEL_COLORS = ["#b4a6ff", "#9079ff", "#6e4ff6", "#10b981", "#f87171"];

export function FunnelChart({ data }: { data: { stage: string; count: number; value: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="stage"
            tickLine={false}
            axisLine={false}
            width={118}
            tick={{ fontSize: 12, fill: "#475569" }}
          />
          <Tooltip
            cursor={{ fill: "#f5f6fb" }}
            contentStyle={{ borderRadius: 12, border: "1px solid #e6e8f0", fontSize: 13 }}
            formatter={(v, _n, item) => [`${v} oportunidade(s) · ${money(item.payload.value)}`, ""]}
          />
          <Bar dataKey="count" radius={[0, 8, 8, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
