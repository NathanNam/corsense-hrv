'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useHeartRate } from '../hooks/use-heart-rate';
import { useStressPrediction } from '../hooks/use-stress-prediction';
import { useNewton } from '../hooks/use-newton';
import { useNewtonStream } from '../hooks/use-newton-stream';
import { ConnectionPanel } from '../components/connection-panel';
import { HeartRateDisplay } from '../components/heart-rate-display';
import { StressIndicator } from '../components/stress-indicator';
import { NewtonIndicator } from '../components/newton-indicator';
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
  const newtonStream = useNewtonStream({
    available: newton.available,
    connected: status === 'connected',
  });

  // Stream RR intervals to Newton as they arrive
  const prevRRLenRef = useRef(0);
  const sendRR = newtonStream.sendRR;
  useEffect(() => {
    if (!newton.available || status !== 'connected') {
      prevRRLenRef.current = 0;
      return;
    }
    const newLen = rrHistory.length;
    if (newLen > prevRRLenRef.current) {
      const newRRs = rrHistory.slice(prevRRLenRef.current).map((p) => p.rr);
      sendRR(newRRs);
      prevRRLenRef.current = newLen;
    }
  }, [rrHistory, newton.available, status, sendRR]);

  const handleAskNewton = useCallback(
    (question: string) => {
      newton.askNewton(question);
    },
    [newton],
  );

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
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
            <div className={`grid grid-cols-1 gap-6 ${newton.available ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
              <HeartRateDisplay
                currentHR={currentHR}
                currentRMSSD={currentRMSSD}
                sensorContact={sensorContact}
              />
              <StressIndicator stress={stress} />
              {newton.available && (
                <NewtonIndicator
                  result={newtonStream.latestResult}
                  streamConnected={newtonStream.streamConnected}
                />
              )}
            </div>

            {/* Newton Chat — full width between metrics and charts */}
            {newton.available && status === 'connected' && (
              <NewtonChat
                messages={newton.messages}
                loading={newton.loading}
                rrCount={rrHistory.length}
                onAsk={handleAskNewton}
              />
            )}

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
