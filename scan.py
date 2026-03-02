"""
Scan for BLE devices - look for the CorSense heart rate monitor.
Activate the CorSense first by placing your finger on the sensor window.
"""

import asyncio
from bleak import BleakScanner

HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"


async def scan():
    print("Scanning for BLE devices (10 seconds)...")
    print("Make sure your CorSense is activated (finger on sensor, blue LED flashing).\n")

    devices = await BleakScanner.discover(
        timeout=10.0,
        return_adv=True,
    )

    hr_devices = []
    all_devices = []

    for device, adv_data in devices.values():
        all_devices.append((device, adv_data))
        # Check if it advertises Heart Rate service or has "CorSense" in the name
        service_uuids = adv_data.service_uuids or []
        name = device.name or adv_data.local_name or ""

        if (
            HEART_RATE_SERVICE_UUID in service_uuids
            or "corsense" in name.lower()
            or "elite" in name.lower()
            or "heart" in name.lower()
        ):
            hr_devices.append((device, adv_data))

    if hr_devices:
        print(f"Found {len(hr_devices)} heart rate device(s):\n")
        for device, adv_data in hr_devices:
            name = device.name or adv_data.local_name or "Unknown"
            print(f"  Name:    {name}")
            print(f"  Address: {device.address}")
            print(f"  RSSI:    {adv_data.rssi} dBm")
            print(f"  UUIDs:   {adv_data.service_uuids}")
            print()
    else:
        print("No heart rate devices found.\n")
        print("All BLE devices discovered:")
        for device, adv_data in sorted(all_devices, key=lambda x: x[1].rssi, reverse=True):
            name = device.name or adv_data.local_name or "Unknown"
            if name != "Unknown":
                print(f"  {name:30s}  {device.address}  RSSI: {adv_data.rssi} dBm")


if __name__ == "__main__":
    asyncio.run(scan())
