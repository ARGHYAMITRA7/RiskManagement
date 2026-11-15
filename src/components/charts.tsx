"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const PALETTE = ["#2f78e8", "#22d3ee", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#64748b", "#14b8a6"];

const tooltipStyle = { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 };

export function TrendChart({ data, xKey, series, height = 260, domain }: { data: Record<string, unknown>[]; xKey: string; series: { key: string; label: string; color?: string }[]; height?: number; domain?: [number, number] | ["auto", "auto"] }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No data yet.</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} domain={domain ?? ["auto", "auto"]} />
          <Tooltip contentStyle={tooltipStyle} />
          {series.length > 1 && <Legend />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChartCard({ data, xKey, yKey, height = 260, color = "#2f78e8", colorByIndex = false, name }: { data: Record<string, unknown>[]; xKey: string; yKey: string; height?: number; color?: string; colorByIndex?: boolean; name?: string }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No data yet.</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? "end" : "middle"} height={data.length > 5 ? 60 : 30} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey={yKey} name={name ?? yKey} radius={[6, 6, 0, 0]} fill={color}>
            {colorByIndex && data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaTrend({ data, xKey, yKey, height = 240, color = "#22d3ee" }: { data: Record<string, unknown>[]; xKey: string; yKey: string; height?: number; color?: string }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No data yet.</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${yKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey={yKey} stroke={color} fill={`url(#grad-${yKey})`} strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data, height = 240 }: { data: { name: string; value: number; color?: string }[]; height?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total === 0) return <p className="py-10 text-center text-sm text-slate-500">No data yet.</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={d.color ?? PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
