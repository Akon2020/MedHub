'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type TrendPoint = { label: string; value: number };

/**
 * Teal area chart in the MedHub style. Loaded on demand (next/dynamic) so that
 * the charting library stays out of the cached application shell.
 */
export default function TrendChart({
  data,
  unit,
  height = 220,
  allowDecimals = true,
}: {
  data: TrendPoint[];
  unit?: string;
  height?: number;
  allowDecimals?: boolean;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6aafba" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#6aafba" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e1eaec" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: '#5d6a78' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={allowDecimals}
            width={44}
            tick={{ fontSize: 12, fill: '#5d6a78' }}
            domain={['auto', 'auto']}
          />
          <Tooltip
            cursor={{ stroke: '#0f6b6b', strokeDasharray: '4 4' }}
            contentStyle={{
              borderRadius: 12,
              border: '1px solid #e1eaec',
              boxShadow: '0 12px 30px -16px rgb(13 29 29 / 0.25)',
              fontSize: 13,
            }}
            formatter={(value) => [`${String(value)}${unit ? ` ${unit}` : ''}`, '']}
            separator=""
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#0f6b6b"
            strokeWidth={2}
            fill="url(#trendFill)"
            activeDot={{ r: 5, fill: '#0f6b6b', stroke: '#fff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
