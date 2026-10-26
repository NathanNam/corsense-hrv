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
import { BeatCleaner, quality } from '../lib/rr-clean';

/** One heartbeat. `time` is ms since the session started. */
export interface Beat {
  time: number;
  rr: number;
  hr: number;
  glitch: boolean;
}

export interface RMSSDPoint {
  time: number;
  rmssd: number;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type Source = 'sensor' | 'demo' | null;

// Ten minutes of beats at up to ~150 bpm.
const MAX_BEATS = 1500;
const RMSSD_WINDOW_MS = 30_000;

export function useHeartRate() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [source, setSource] = useState<Source>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [sensorLocation, setSensorLocation] = useState<string | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [sensorContact, setSensorContact] = useState<boolean | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [rmssdHistory, setRMSSDHistory] = useState<RMSSDPoint[]>([]);
  const [demoLabel, setDemoLabel] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const startTimeRef = useRef<number>(0);
  const prevDataRef = useRef<HeartRateData | null>(null);
  const cleanerRef = useRef(new BeatCleaner());
  const beatsRef = useRef<Beat[]>([]);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Adds RR intervals (ms) that ended at `endTime`, cleaning each one. */
  const ingest = useCallback((rrs: number[], endTime: number) => {
    let t = endTime - rrs.slice(1).reduce((a, b) => a + b, 0);
    const added: Beat[] = rrs.map((rr, i) => {
      if (i > 0) t += rr;
      const glitch = !cleanerRef.current.check(rr).ok;
      return { time: t, rr, hr: Math.round(60000 / rr), glitch };
    });
    const all = [...beatsRef.current, ...added].slice(-MAX_BEATS);
    beatsRef.current = all;
    setBeats(all);

    const last = all[all.length - 1];
    const recentClean = all.filter((b) => !b.glitch && b.time > last.time - RMSSD_WINDOW_MS).map((b) => b.rr);
    // Fewer than 10 beats gives a wild RMSSD; wait for a fuller window.
    const rmssd = recentClean.length >= 10 ? calculateRMSSD(recentClean) : null;
    if (rmssd !== null) {
      setRMSSDHistory((prev) => [...prev, { time: last.time, rmssd: Math.round(rmssd * 10) / 10 }].slice(-MAX_BEATS));
    }
  }, []);

  const resetSession = useCallback(() => {
    cleanerRef.current.reset();
    beatsRef.current = [];
    prevDataRef.current = null;
    setBeats([]);
    setRMSSDHistory([]);
    setSensorContact(null);
  }, []);

  const handleNotification = useCallback((event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const data = parseHeartRate(value);

    // CorSense repeats the same packet between beats.
    const prev = prevDataRef.current;
    if (prev && data.heartRate === prev.heartRate && data.rrIntervals.length === prev.rrIntervals.length && data.rrIntervals.every((rr, i) => rr === prev.rrIntervals[i])) return;
    prevDataRef.current = data;
    setSensorContact(data.sensorContact);
    if (data.rrIntervals.length > 0) ingest(data.rrIntervals, Date.now() - startTimeRef.current);
  }, [ingest]);

  const handleDisconnect = useCallback(() => {
    setStatus('disconnected');
    characteristicRef.current = null;
  }, []);

  const stopDemo = useCallback(() => {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    demoTimerRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      setError('This browser has no Web Bluetooth. Use Chrome or Edge on a laptop or Android, or try the demo.');
      setStatus('error');
      return;
    }
    try {
      stopDemo();
      setStatus('connecting');
      setError(null);
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HR_SERVICE_UUID] }],
        optionalServices: [BATTERY_SERVICE_UUID],
      });
      deviceRef.current = device;
      setDeviceName(device.name || 'Heart rate sensor');
      device.addEventListener('gattserverdisconnected', handleDisconnect);
      const server = await device.gatt!.connect();
      const hrService = await server.getPrimaryService(HR_SERVICE_UUID);
      try {
        const loc = await (await hrService.getCharacteristic(BODY_SENSOR_LOCATION_UUID)).readValue();
        setSensorLocation(SENSOR_LOCATIONS[loc.getUint8(0)] || null);
      } catch { /* optional */ }
      try {
        const battery = await (await (await server.getPrimaryService(BATTERY_SERVICE_UUID)).getCharacteristic(BATTERY_LEVEL_UUID)).readValue();
        setBatteryLevel(battery.getUint8(0));
      } catch { /* optional */ }
      const hrChar = await hrService.getCharacteristic(HR_MEASUREMENT_UUID);
      characteristicRef.current = hrChar;
      hrChar.addEventListener('characteristicvaluechanged', handleNotification);
      await hrChar.startNotifications();
      resetSession();
      startTimeRef.current = Date.now();
      setSource('sensor');
      setDemoLabel(null);
      setStatus('connected');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') setStatus('idle');
      else { setError(err instanceof Error ? err.message : 'Connection failed'); setStatus('error'); }
    }
  }, [handleNotification, handleDisconnect, resetSession, stopDemo]);

  /**
   * Plays a recorded WESAD session (relaxed, then stressed) through the same
   * cleaning and models as a live sensor. The first `preloadMs` (two minutes by
   * default) are filled in at once so the screen isn't empty; the rest plays in
   * real time.
   */
  const startDemo = useCallback(async (preloadMs = 120_000) => {
    stopDemo();
    resetSession();
    setError(null);
    const res = await fetch('/demo/wesad-session.json');
    const session: { segments: { label: string; rr: number[] }[] } = await res.json();
    const queue = session.segments.flatMap((s) => s.rr.map((rr) => ({ rr, label: s.label })));
    setSource('demo');
    setDeviceName('Recorded session');
    setSensorLocation(null);
    setBatteryLevel(null);
    setStatus('connected');
    let i = 0, t = 0;
    while (i < queue.length && t < preloadMs) { t += queue[i].rr; ingest([queue[i].rr], t); i++; }
    setDemoLabel(queue[Math.max(0, i - 1)]?.label ?? null);
    startTimeRef.current = Date.now() - t;
    const next = () => {
      if (i >= queue.length) { setStatus('disconnected'); return; }
      const beat = queue[i++];
      demoTimerRef.current = setTimeout(() => {
        t += beat.rr;
        ingest([beat.rr], t);
        setDemoLabel(beat.label);
        next();
      }, beat.rr);
    };
    next();
  }, [ingest, resetSession, stopDemo]);

  const disconnect = useCallback(() => {
    stopDemo();
    const characteristic = characteristicRef.current;
    if (characteristic) {
      characteristic.removeEventListener('characteristicvaluechanged', handleNotification);
      try { characteristic.stopNotifications(); } catch { /* may be gone */ }
    }
    const device = deviceRef.current;
    if (device) {
      device.removeEventListener('gattserverdisconnected', handleDisconnect);
      if (device.gatt?.connected) device.gatt.disconnect();
    }
    deviceRef.current = null;
    characteristicRef.current = null;
    setStatus('idle');
    setSource(null);
    setDemoLabel(null);
    resetSession();
  }, [handleNotification, handleDisconnect, resetSession, stopDemo]);

  const flags = beats.map((b) => !b.glitch);
  const lastClean = [...beats].reverse().filter((b) => !b.glitch).slice(0, 5);
  const currentHR = lastClean.length ? Math.round(lastClean.reduce((a, b) => a + b.hr, 0) / lastClean.length) : null;

  return {
    status,
    source,
    demoLabel,
    error,
    deviceName,
    sensorLocation,
    batteryLevel,
    sensorContact,
    beats,
    rmssdHistory,
    currentHR,
    currentRMSSD: rmssdHistory.length ? rmssdHistory[rmssdHistory.length - 1].rmssd : null,
    signalQuality: beats.length ? quality(flags) : null,
    glitchesRemoved: beats.filter((b) => b.glitch).length,
    connect,
    startDemo,
    disconnect,
  };
}
