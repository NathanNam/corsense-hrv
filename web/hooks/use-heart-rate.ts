'use client';

import { useState, useRef, useCallback } from 'react';
import {
  HR_SERVICE_UUID,
  HR_MEASUREMENT_UUID,
  BODY_SENSOR_LOCATION_UUID,
  BATTERY_SERVICE_UUID,
  BATTERY_LEVEL_UUID,
  SENSOR_LOCATIONS,
} from '../lib/ble-constants';
import { parseHeartRate, HeartRateData } from '../lib/parse-heart-rate';
import { calculateRMSSD } from '../lib/hrv';

export interface DataPoint {
  time: number;
  timestamp: string;
}

export interface HRPoint extends DataPoint {
  hr: number;
}

export interface RRPoint extends DataPoint {
  rr: number;
}

export interface RMSSDPoint extends DataPoint {
  rmssd: number;
}

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

const MAX_HISTORY = 300;
const MAX_RR_BUFFER = 120;

export function useHeartRate() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [sensorLocation, setSensorLocation] = useState<string | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [currentHR, setCurrentHR] = useState<number | null>(null);
  const [currentRMSSD, setCurrentRMSSD] = useState<number | null>(null);
  const [sensorContact, setSensorContact] = useState<boolean | null>(null);
  const [hrHistory, setHRHistory] = useState<HRPoint[]>([]);
  const [rrHistory, setRRHistory] = useState<RRPoint[]>([]);
  const [rmssdHistory, setRMSSDHistory] = useState<RMSSDPoint[]>([]);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const startTimeRef = useRef<number>(0);
  const rrBufferRef = useRef<number[]>([]);
  const prevDataRef = useRef<HeartRateData | null>(null);

  const handleNotification = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    if (!value) return;

    const data = parseHeartRate(value);

    // Skip duplicates (CorSense repeats data between beats)
    const prev = prevDataRef.current;
    if (
      prev &&
      data.heartRate === prev.heartRate &&
      data.rrIntervals.length === prev.rrIntervals.length &&
      data.rrIntervals.every((rr, i) => rr === prev.rrIntervals[i])
    ) {
      return;
    }
    prevDataRef.current = data;

    const now = Date.now();
    const time = now - startTimeRef.current;
    const timestamp = new Date(now).toLocaleTimeString();

    setSensorContact(data.sensorContact);

    if (data.rrIntervals.length > 0) {
      // Derive instantaneous HR from each RR interval (beat-by-beat resolution)
      const instantaneousHRs = data.rrIntervals.map((rr) => Math.round(60000 / rr));
      setCurrentHR(instantaneousHRs[instantaneousHRs.length - 1]);

      // Create one HR point per beat, spaced by RR interval timing
      let beatTime = time;
      const hrPoints: HRPoint[] = [];
      const rrPoints: RRPoint[] = [];
      for (let i = 0; i < data.rrIntervals.length; i++) {
        if (i > 0) beatTime += data.rrIntervals[i];
        const beatTimestamp = new Date(startTimeRef.current + beatTime).toLocaleTimeString();
        hrPoints.push({ time: beatTime, timestamp: beatTimestamp, hr: instantaneousHRs[i] });
        rrPoints.push({ time: beatTime, timestamp: beatTimestamp, rr: data.rrIntervals[i] });
      }

      setHRHistory((prev) => {
        const next = [...prev, ...hrPoints];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });

      // Update RR buffer and history
      const buffer = rrBufferRef.current;
      buffer.push(...data.rrIntervals);
      if (buffer.length > MAX_RR_BUFFER) {
        rrBufferRef.current = buffer.slice(-MAX_RR_BUFFER);
      }

      setRRHistory((prev) => {
        const next = [...prev, ...rrPoints];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });

      // Compute RMSSD
      const rmssd = calculateRMSSD(rrBufferRef.current);
      if (rmssd !== null) {
        const rounded = Math.round(rmssd * 10) / 10;
        setCurrentRMSSD(rounded);
        setRMSSDHistory((prev) => {
          const next = [...prev, { time, timestamp, rmssd: rounded }];
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
        });
      }
    } else {
      // Fallback: use device-reported HR when no RR intervals available
      setCurrentHR(data.heartRate);
      setHRHistory((prev) => {
        const next = [...prev, { time, timestamp, hr: data.heartRate }];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    setStatus('disconnected');
    characteristicRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setError('Web Bluetooth is not supported. Use Chrome or Edge.');
      setStatus('error');
      return;
    }

    try {
      setStatus('connecting');
      setError(null);

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HR_SERVICE_UUID] }],
        optionalServices: [BATTERY_SERVICE_UUID],
      });

      deviceRef.current = device;
      setDeviceName(device.name || 'Unknown Device');
      device.addEventListener('gattserverdisconnected', handleDisconnect);

      const server = await device.gatt!.connect();

      // Heart Rate service
      const hrService = await server.getPrimaryService(HR_SERVICE_UUID);

      // Read sensor location
      try {
        const locationChar = await hrService.getCharacteristic(BODY_SENSOR_LOCATION_UUID);
        const locationValue = await locationChar.readValue();
        setSensorLocation(SENSOR_LOCATIONS[locationValue.getUint8(0)] || 'Unknown');
      } catch {
        // Optional characteristic
      }

      // Read battery level
      try {
        const batteryService = await server.getPrimaryService(BATTERY_SERVICE_UUID);
        const batteryChar = await batteryService.getCharacteristic(BATTERY_LEVEL_UUID);
        const batteryValue = await batteryChar.readValue();
        setBatteryLevel(batteryValue.getUint8(0));
      } catch {
        // Optional service
      }

      // Subscribe to HR notifications
      const hrChar = await hrService.getCharacteristic(HR_MEASUREMENT_UUID);
      characteristicRef.current = hrChar;
      hrChar.addEventListener('characteristicvaluechanged', handleNotification);
      await hrChar.startNotifications();

      startTimeRef.current = Date.now();
      rrBufferRef.current = [];
      prevDataRef.current = null;
      setStatus('connected');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        // User cancelled the device picker
        setStatus('idle');
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed');
        setStatus('error');
      }
    }
  }, [handleNotification, handleDisconnect]);

  const disconnect = useCallback(() => {
    const characteristic = characteristicRef.current;
    if (characteristic) {
      characteristic.removeEventListener('characteristicvaluechanged', handleNotification);
      try {
        characteristic.stopNotifications();
      } catch {
        // May already be disconnected
      }
    }

    const device = deviceRef.current;
    if (device) {
      device.removeEventListener('gattserverdisconnected', handleDisconnect);
      if (device.gatt?.connected) {
        device.gatt.disconnect();
      }
    }

    deviceRef.current = null;
    characteristicRef.current = null;
    setStatus('idle');
    setCurrentHR(null);
    setCurrentRMSSD(null);
    setSensorContact(null);
    setHRHistory([]);
    setRRHistory([]);
    setRMSSDHistory([]);
    rrBufferRef.current = [];
    prevDataRef.current = null;
  }, [handleNotification, handleDisconnect]);

  return {
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
  };
}
