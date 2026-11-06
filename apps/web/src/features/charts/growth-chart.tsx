'use client';

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type GrowthLinePoint = {
  x: number;
  m3: number;
  m2: number;
  m0: number;
  p2: number;
  p3: number;
};
export type GrowthMeasure = { x: number; y: number };

/**
 * Child's measurements over the WHO reference lines (-3, -2, median, +2, +3
 * SD). Loaded on demand, like the other charts.
 */
export default function GrowthChart({
  lines,
  points,
  xLabel,
  unit,
}: {
  lines: GrowthLinePoint[];
  points: GrowthMeasure[];
  xLabel: string;
  unit: string;
}) {
  const data = [
    ...lines.map((l) => ({ ...l })),
    ...points.map((p) => ({ x: p.x, child: p.y })),
  ].sort((a, b) => a.x - b.x);
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            label={{ value: xLabel, position: 'insideBottomRight', offset: -4, fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            width={40}
            unit={` ${unit}`}
          />
          <Tooltip
            formatter={(value) => (typeof value === 'number' ? value.toFixed(1) : String(value))}
            labelFormatter={(x) => String(x)}
          />
          <Line dataKey="m3" stroke="var(--danger)" dot={false} strokeWidth={1} connectNulls />
          <Line dataKey="m2" stroke="var(--warning)" dot={false} strokeWidth={1} connectNulls />
          <Line dataKey="m0" stroke="var(--primary)" dot={false} strokeWidth={1.5} connectNulls />
          <Line dataKey="p2" stroke="var(--warning)" dot={false} strokeWidth={1} connectNulls />
          <Line dataKey="p3" stroke="var(--danger)" dot={false} strokeWidth={1} connectNulls />
          <Scatter dataKey="child" fill="var(--foreground)" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
