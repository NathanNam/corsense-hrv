'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { RMSSDPoint } from '../hooks/use-heart-rate';

interface RMSSDChartProps {
  data: RMSSDPoint[];
}

export function RMSSDChart({ data }: RMSSDChartProps) {
  if (data.length === 0) return null;

  return (
    <div id="chart-rmssd" className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <h3 className="text-sm font-medium text-gray-500 mb-3">HRV (RMSSD) Over Time</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
            stroke="#9ca3af"
          />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fontSize: 10 }}
            stroke="#9ca3af"
            width={40}
          />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value) => [`${value} ms`, 'RMSSD']}
          />
          <Area
            type="monotone"
            dataKey="rmssd"
            stroke="#22c55e"
            fill="#22c55e"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
