'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { RRPoint } from '../hooks/use-heart-rate';

interface RRChartProps {
  data: RRPoint[];
}

export function RRChart({ data }: RRChartProps) {
  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <h3 className="text-sm font-medium text-gray-500 mb-3">RR Intervals</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
            stroke="#9ca3af"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke="#9ca3af"
            width={40}
          />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value) => [`${value} ms`, 'RR']}
          />
          <Line
            type="monotone"
            dataKey="rr"
            stroke="#3b82f6"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
