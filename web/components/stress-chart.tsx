'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { MODEL_CONFIG } from '../lib/stress-predictor';

interface StressChartProps {
  data: { time: number; timestamp: string; probability: number }[];
}

export function StressChart({ data }: StressChartProps) {
  if (data.length === 0) return null;

  const threshold = MODEL_CONFIG.threshold;

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <h3 className="text-sm font-medium text-gray-500 mb-3">Stress Probability Over Time</h3>
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
            domain={[0, 1]}
            tick={{ fontSize: 10 }}
            stroke="#9ca3af"
            width={40}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
          />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, 'Stress Probability']}
          />
          <ReferenceLine
            y={threshold}
            stroke="#ef4444"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{ value: 'Threshold', position: 'right', fontSize: 10, fill: '#ef4444' }}
          />
          <Area
            type="monotone"
            dataKey="probability"
            stroke="#f59e0b"
            fill="#f59e0b"
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
