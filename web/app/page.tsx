'use client';

import { useHeartRate } from '../hooks/use-heart-rate';
import { useStressPrediction } from '../hooks/use-stress-prediction';
import { ConnectionPanel } from '../components/connection-panel';
import { HeartRateDisplay } from '../components/heart-rate-display';
import { StressIndicator } from '../components/stress-indicator';
import { HRChart } from '../components/hr-chart';
import { RRChart } from '../components/rr-chart';
import { RMSSDChart } from '../components/rmssd-chart';
import { StressChart } from '../components/stress-chart';

export default function Home() {
  const {
    status,
    error,
    deviceName,
    sensorLocation,
    batteryLevel,
    currentHR,
    currentRMSSD,
    sensorContact,
    hrHistory,
    rrHistory,
    rmssdHistory,
    connect,
    disconnect,
  } = useHeartRate();

  const stress = useStressPrediction(rrHistory);

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">HRV Monitor</h1>

        <ConnectionPanel
          status={status}
          error={error}
          deviceName={deviceName}
          sensorLocation={sensorLocation}
          batteryLevel={batteryLevel}
          onConnect={connect}
          onDisconnect={disconnect}
        />

        {(status === 'connected' || status === 'disconnected') && currentHR !== null && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <HeartRateDisplay
                currentHR={currentHR}
                currentRMSSD={currentRMSSD}
                sensorContact={sensorContact}
              />
              <StressIndicator stress={stress} />
            </div>

            <div className="grid gap-6">
              <StressChart data={stress.history} />
              <HRChart data={hrHistory} />
              <RRChart data={rrHistory} />
              <RMSSDChart data={rmssdHistory} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
