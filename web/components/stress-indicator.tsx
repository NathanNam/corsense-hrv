'use client';

import { MODEL_CONFIG } from '../lib/stress-predictor';
import type { StressState } from '../hooks/use-stress-prediction';

interface StressIndicatorProps {
  stress: StressState;
}

export function StressIndicator({ stress }: StressIndicatorProps) {
  const { prediction, windowCount, ready } = stress;

  if (!ready || !prediction) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
              Stress Detection
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              Collecting data... {windowCount}/10 beats
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="text-gray-400 text-lg">--</span>
          </div>
        </div>
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gray-300 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, (windowCount / 10) * 100)}%` }}
          />
        </div>
      </div>
    );
  }

  const pct = Math.round(prediction.probability * 100);
  const isStress = prediction.isStress;

  const bgColor = isStress ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200';
  const textColor = isStress ? 'text-red-700' : 'text-emerald-700';
  const labelColor = isStress ? 'text-red-500' : 'text-emerald-500';
  const dotColor = isStress ? 'bg-red-500' : 'bg-emerald-500';
  const barColor = isStress ? 'bg-red-400' : 'bg-emerald-400';
  const label = isStress ? 'Stress Detected' : 'Relaxed';

  return (
    <div className={`rounded-xl p-5 shadow-sm border ${bgColor}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ${isStress ? 'animate-pulse' : ''}`} />
            <h3 className={`text-sm font-medium uppercase tracking-wide ${labelColor}`}>
              Stress Detection
            </h3>
          </div>
          <p className={`text-2xl font-bold mt-1 ${textColor}`}>
            {label}
          </p>
        </div>
        <div className={`text-3xl font-bold tabular-nums ${textColor}`}>
          {pct}%
        </div>
      </div>

      {/* Probability bar */}
      <div className="mt-3 h-2 bg-white/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-400">Relaxed</span>
        <span className="text-xs text-gray-400">Threshold: {Math.round(MODEL_CONFIG.threshold * 100)}%</span>
        <span className="text-xs text-gray-400">Stressed</span>
      </div>
    </div>
  );
}
