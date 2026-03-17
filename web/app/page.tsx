'use client';

import { useCallback } from 'react';
import { useHeartRate } from '../hooks/use-heart-rate';
import { useStressPrediction } from '../hooks/use-stress-prediction';
import { useNewton } from '../hooks/use-newton';
import { ConnectionPanel } from '../components/connection-panel';
import { HeartRateDisplay } from '../components/heart-rate-display';
import { StressIndicator } from '../components/stress-indicator';
import { HRChart } from '../components/hr-chart';
import { RRChart } from '../components/rr-chart';
import { RMSSDChart } from '../components/rmssd-chart';
import { StressChart } from '../components/stress-chart';
import { NewtonChat } from '../components/newton-chat';

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
  const newton = useNewton();

  const handleAskNewton = useCallback(
    (question: string) => {
      const rrValues = rrHistory.map((p) => p.rr);
      const hrvMetrics = stress.prediction
        ? {
            stressProbability: stress.prediction.probability,
            isStress: stress.prediction.isStress,
            rmssd: currentRMSSD,
            heartRate: currentHR,
          }
        : undefined;
      newton.askNewton(question, rrValues, hrvMetrics);
    },
    [rrHistory, stress.prediction, currentRMSSD, currentHR, newton],
  );

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className={`mx-auto ${newton.available ? 'max-w-6xl' : 'max-w-4xl'}`}>
        <div className="flex gap-6">
          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-6">
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

          {/* Newton side panel */}
          {newton.available && status === 'connected' && currentHR !== null && (
            <div className="hidden lg:block w-80 shrink-0 sticky top-6 self-start">
              <NewtonChat
                messages={newton.messages}
                loading={newton.loading}
                rrCount={rrHistory.length}
                onAsk={handleAskNewton}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
