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
import type { HRPoint } from '../hooks/use-heart-rate';

interface HRChartProps {
  data: HRPoint[];
}

export function HRChart({ data }: HRChartProps) {
  if (data.length === 0) return null;

  return (
    <div id="chart-hr" className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <h3 className="text-sm font-medium text-gray-500 mb-3">Heart Rate Over Time</h3>
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
            domain={['dataMin - 5', 'dataMax + 5']}
            tick={{ fontSize: 10 }}
            stroke="#9ca3af"
            width={40}
          />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value) => [`${value} bpm`, 'HR']}
          />
          <Line
            type="monotone"
            dataKey="hr"
            stroke="#ef4444"
            dot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
