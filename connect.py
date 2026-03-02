"""
Connect to the CorSense and stream heart rate + R-R interval (HRV) data.

Usage:
  python connect.py                  # auto-scan for CorSense
  python connect.py <device_address> # connect to specific address

Activate the CorSense first by placing your finger on the sensor window.
The blue LED should be flashing.
"""

import asyncio
import sys
import signal
from datetime import datetime
from collections import deque

from bleak import BleakClient, BleakScanner

# Standard BLE Heart Rate Profile UUIDs
HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
BODY_SENSOR_LOCATION_UUID = "00002a38-0000-1000-8000-00805f9b34fb"

# Battery Service
BATTERY_LEVEL_UUID = "00002a19-0000-1000-8000-00805f9b34fb"

running = True
prev_data = None
rr_history = deque(maxlen=120)  # Store last ~2 min of RR intervals for HRV


def parse_heart_rate(data: bytearray):
    """Parse the Heart Rate Measurement characteristic per BLE HR Profile spec."""
    flags = data[0]
    hr_format_16bit = bool(flags & 0x01)
    sensor_contact_supported = bool(flags & 0x02)
    sensor_contact_detected = bool(flags & 0x04)
    energy_expended_present = bool(flags & 0x08)
    rr_interval_present = bool(flags & 0x10)

    offset = 1

    if hr_format_16bit:
        heart_rate = int.from_bytes(data[offset:offset + 2], byteorder="little")
        offset += 2
    else:
        heart_rate = data[offset]
        offset += 1

    if energy_expended_present:
        offset += 2  # skip energy expended field

    rr_intervals_ms = []
    if rr_interval_present:
        while offset + 1 < len(data):
            rr_raw = int.from_bytes(data[offset:offset + 2], byteorder="little")
            rr_ms = (rr_raw / 1024.0) * 1000.0
            # Only keep physiologically plausible values (30-220 bpm → 273-2000 ms)
            if 273 <= rr_ms <= 2000:
                rr_intervals_ms.append(rr_ms)
            offset += 2

    return {
        "heart_rate": heart_rate,
        "sensor_contact": sensor_contact_detected if sensor_contact_supported else None,
        "rr_intervals_ms": rr_intervals_ms,
    }


def hr_notification_handler(sender, data: bytearray):
    """Handle incoming heart rate measurement notifications."""
    global prev_data

    # Skip duplicate notifications (CorSense sends same data until new beat)
    if data == prev_data:
        return
    prev_data = bytearray(data)

    result = parse_heart_rate(data)
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]

    hr = result["heart_rate"]
    contact = result["sensor_contact"]
    rr_intervals = result["rr_intervals_ms"]

    # Build output parts
    parts = [f"[{timestamp}] HR: {hr} bpm"]

    if contact is not None:
        parts.append(f"Contact: {'YES' if contact else 'NO'}")

    if rr_intervals:
        rr_history.extend(rr_intervals)
        rr_str = ", ".join(f"{rr:.0f}" for rr in rr_intervals)
        parts.append(f"RR: [{rr_str}] ms")

        # Compute rolling RMSSD from accumulated RR intervals
        if len(rr_history) >= 2:
            rr_list = list(rr_history)
            diffs_sq = [(rr_list[i+1] - rr_list[i])**2
                        for i in range(len(rr_list) - 1)]
            rmssd = (sum(diffs_sq) / len(diffs_sq)) ** 0.5
            parts.append(f"RMSSD: {rmssd:.1f} ms")

    print(" | ".join(parts))


SENSOR_LOCATIONS = {
    0: "Other", 1: "Chest", 2: "Wrist", 3: "Finger",
    4: "Hand", 5: "Ear Lobe", 6: "Foot",
}


async def find_corsense():
    """Scan for CorSense device."""
    print("Scanning for CorSense (10 seconds)...")
    print("Place your finger on the sensor to activate it.\n")

    devices = await BleakScanner.discover(timeout=10.0, return_adv=True)

    for device, adv_data in devices.values():
        name = device.name or adv_data.local_name or ""
        service_uuids = adv_data.service_uuids or []

        if (
            HR_SERVICE_UUID in service_uuids
            or "corsense" in name.lower()
            or "elite" in name.lower()
        ):
            print(f"Found: {name} ({device.address})")
            return device.address

    return None


async def connect_and_stream(address: str):
    """Connect to the device and stream HR data."""
    global running

    print(f"\nConnecting to {address}...")

    async with BleakClient(address, timeout=20.0) as client:
        print(f"Connected: {client.is_connected}")

        # Print device services
        print("\nDevice services:")
        for service in client.services:
            print(f"  [{service.uuid}] {service.description}")

        # Read sensor location
        try:
            location_data = await client.read_gatt_char(BODY_SENSOR_LOCATION_UUID)
            location = SENSOR_LOCATIONS.get(location_data[0], f"Unknown ({location_data[0]})")
            print(f"\nSensor location: {location}")
        except Exception:
            pass

        # Read battery level
        try:
            battery_data = await client.read_gatt_char(BATTERY_LEVEL_UUID)
            print(f"Battery level: {battery_data[0]}%")
        except Exception:
            pass

        # Subscribe to heart rate notifications
        print("\n--- Streaming Heart Rate & HRV Data (Ctrl+C to stop) ---")
        print("--- Keep finger still on sensor while it calibrates ---\n")
        await client.start_notify(HR_MEASUREMENT_UUID, hr_notification_handler)

        try:
            while running and client.is_connected:
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                await client.stop_notify(HR_MEASUREMENT_UUID)
            except Exception:
                pass
            print("\nDisconnected.")


async def main():
    global running

    loop = asyncio.get_event_loop()
    loop.add_signal_handler(signal.SIGINT, lambda: setattr(sys.modules[__name__], 'running', False))

    if len(sys.argv) > 1:
        address = sys.argv[1]
    else:
        address = await find_corsense()
        if not address:
            print("\nCorSense not found. Make sure:")
            print("  1. Your finger is on the sensor (blue LED flashing)")
            print("  2. Bluetooth is enabled on your Mac")
            print("  3. The device is charged")
            print("\nTry running scan.py to see all BLE devices.")
            return

    await connect_and_stream(address)


if __name__ == "__main__":
    asyncio.run(main())
