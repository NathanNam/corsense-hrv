'use client';

interface HeartRateDisplayProps {
  currentHR: number | null;
  currentRMSSD: number | null;
  sensorContact: boolean | null;
}

export function HeartRateDisplay({ currentHR, currentRMSSD, sensorContact }: HeartRateDisplayProps) {
  const pulseDuration = currentHR && currentHR > 0 ? 60 / currentHR : 1;

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 text-center">
      <div className="flex items-center justify-center gap-2 mb-2">
        {sensorContact !== null && (
          <div
            className={`w-2 h-2 rounded-full ${sensorContact ? 'bg-green-500' : 'bg-red-400 animate-pulse'}`}
            title={sensorContact ? 'Sensor contact detected' : 'No sensor contact'}
          />
        )}
        <span className="text-sm text-gray-500 uppercase tracking-wide">Heart Rate</span>
      </div>

      <div
        className="animate-pulse-heart inline-block"
        style={{ '--pulse-duration': `${pulseDuration}s` } as React.CSSProperties}
      >
        <span className="text-7xl font-bold tabular-nums text-gray-900">
          {currentHR ?? '--'}
        </span>
      </div>
      <p className="text-lg text-gray-400 mt-1">bpm</p>

      {currentRMSSD !== null && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <span className="text-sm text-gray-500 uppercase tracking-wide">HRV (RMSSD)</span>
          <p className="text-3xl font-semibold tabular-nums text-gray-800 mt-1">
            {currentRMSSD.toFixed(1)}
            <span className="text-base text-gray-400 ml-1">ms</span>
          </p>
        </div>
      )}
    </div>
  );
}
