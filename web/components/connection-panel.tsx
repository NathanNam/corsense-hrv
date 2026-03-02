'use client';

import { useState, useEffect } from 'react';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface ConnectionPanelProps {
  status: ConnectionStatus;
  error: string | null;
  deviceName: string | null;
  sensorLocation: string | null;
  batteryLevel: number | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  idle: 'bg-gray-400',
  connecting: 'bg-yellow-400 animate-pulse',
  connected: 'bg-green-500',
  disconnected: 'bg-orange-400',
  error: 'bg-red-500',
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

export function ConnectionPanel({
  status,
  error,
  deviceName,
  sensorLocation,
  batteryLevel,
  onConnect,
  onDisconnect,
}: ConnectionPanelProps) {
  const [bluetoothSupported, setBluetoothSupported] = useState(true);

  useEffect(() => {
    setBluetoothSupported('bluetooth' in navigator);
  }, []);

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[status]}`} />
          <div>
            <p className="font-medium text-gray-900">
              {deviceName || STATUS_LABELS[status]}
            </p>
            {status === 'connected' && (
              <p className="text-sm text-gray-500">
                {[sensorLocation, batteryLevel !== null ? `${batteryLevel}% battery` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>

        {status === 'connected' ? (
          <button
            onClick={onDisconnect}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={status === 'connecting' || !bluetoothSupported}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {status === 'connecting' ? 'Connecting...' : 'Connect HR Monitor'}
          </button>
        )}
      </div>

      {!bluetoothSupported && (
        <p className="mt-3 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
          Web Bluetooth is not supported in this browser. Please use Chrome or Edge on desktop.
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg p-3">{error}</p>
      )}

      {status === 'disconnected' && (
        <p className="mt-3 text-sm text-gray-500">
          Device disconnected. Place your finger on the sensor and reconnect.
        </p>
      )}
    </div>
  );
}
