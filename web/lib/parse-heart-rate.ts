export interface HeartRateData {
  heartRate: number;
  sensorContact: boolean | null;
  rrIntervals: number[]; // milliseconds
}

/**
 * Parse the BLE Heart Rate Measurement characteristic value.
 * Port of connect.py parse_heart_rate().
 */
export function parseHeartRate(dataView: DataView): HeartRateData {
  const flags = dataView.getUint8(0);
  const hrFormat16bit = !!(flags & 0x01);
  const sensorContactSupported = !!(flags & 0x02);
  const sensorContactDetected = !!(flags & 0x04);
  const energyExpendedPresent = !!(flags & 0x08);
  const rrIntervalPresent = !!(flags & 0x10);

  let offset = 1;

  let heartRate: number;
  if (hrFormat16bit) {
    heartRate = dataView.getUint16(offset, true);
    offset += 2;
  } else {
    heartRate = dataView.getUint8(offset);
    offset += 1;
  }

  if (energyExpendedPresent) {
    offset += 2;
  }

  const rrIntervals: number[] = [];
  if (rrIntervalPresent) {
    while (offset + 1 < dataView.byteLength) {
      const rrRaw = dataView.getUint16(offset, true);
      const rrMs = (rrRaw / 1024.0) * 1000.0;
      if (rrMs >= 273 && rrMs <= 2000) {
        rrIntervals.push(Math.round(rrMs * 10) / 10);
      }
      offset += 2;
    }
  }

  return {
    heartRate,
    sensorContact: sensorContactSupported ? sensorContactDetected : null,
    rrIntervals,
  };
}
