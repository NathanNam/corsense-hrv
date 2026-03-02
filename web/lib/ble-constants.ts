// Standard BLE Heart Rate Profile UUIDs (Web Bluetooth short names)
export const HR_SERVICE_UUID = 'heart_rate';
export const HR_MEASUREMENT_UUID = 'heart_rate_measurement';
export const BODY_SENSOR_LOCATION_UUID = 'body_sensor_location';
export const BATTERY_SERVICE_UUID = 'battery_service';
export const BATTERY_LEVEL_UUID = 'battery_level';

export const SENSOR_LOCATIONS: Record<number, string> = {
  0: 'Other',
  1: 'Chest',
  2: 'Wrist',
  3: 'Finger',
  4: 'Hand',
  5: 'Ear Lobe',
  6: 'Foot',
};
