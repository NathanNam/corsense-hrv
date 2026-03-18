'use client';

import { useEffect, useState } from 'react';
import type { NewtonStreamResult } from '../hooks/use-newton-stream';

interface NewtonIndicatorProps {
  result: NewtonStreamResult | null;
  streamConnected: boolean;
}

export function NewtonIndicator({ result, streamConnected }: NewtonIndicatorProps) {
  const [age, setAge] = useState(0);

  useEffect(() => {
    if (!result) {
      setAge(0);
      return;
    }
    const update = () => setAge(Math.floor((Date.now() - result.timestamp) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [result]);

  if (!streamConnected) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
              Newton AI
            </h3>
            <p className="text-sm text-gray-400 mt-1">Connecting...</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <span className="text-gray-400 text-lg">--</span>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
              Newton AI
            </h3>
            <p className="text-sm text-gray-400 mt-1">Collecting data...</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  const isStressed = result.label === 'stressed';
  const stressedPct = Math.round(result.scores.stressed ?? 0);
  const relaxedPct = Math.round(result.scores.relaxed ?? 0);
  const stale = age > 30;

  const bgColor = stale
    ? 'bg-gray-50 border-gray-200'
    : isStressed
      ? 'bg-red-50 border-red-200'
      : 'bg-emerald-50 border-emerald-200';
  const textColor = stale ? 'text-gray-400' : isStressed ? 'text-red-700' : 'text-emerald-700';
  const labelColor = stale ? 'text-gray-400' : isStressed ? 'text-red-500' : 'text-emerald-500';
  const dotColor = stale ? 'bg-gray-400' : isStressed ? 'bg-red-500' : 'bg-emerald-500';
  const barColor = stale ? 'bg-gray-300' : isStressed ? 'bg-red-400' : 'bg-emerald-400';
  const label = isStressed ? 'Stressed' : 'Relaxed';

  const ageText = age < 5 ? 'Just now' : age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`;

  return (
    <div className={`rounded-xl p-5 shadow-sm border ${bgColor}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ${!stale && isStressed ? 'animate-pulse' : ''}`} />
            <h3 className={`text-sm font-medium uppercase tracking-wide ${labelColor}`}>
              Newton AI
            </h3>
          </div>
          <p className={`text-2xl font-bold mt-1 ${textColor}`}>
            {label}
          </p>
        </div>
        <div className={`text-3xl font-bold tabular-nums ${textColor}`}>
          {isStressed ? stressedPct : relaxedPct}%
        </div>
      </div>

      <div className="mt-3 h-2 bg-white/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${stressedPct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-400">Relaxed {relaxedPct}%</span>
        <span className="text-xs text-gray-400">{result.windows} windows · {ageText}</span>
        <span className="text-xs text-gray-400">Stressed {stressedPct}%</span>
      </div>
    </div>
  );
}
