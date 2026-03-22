#!/usr/bin/env python3
"""
Newton HRV Experiment — Real-time CorSense → Newton pipeline.

Connects to a CorSense heart rate monitor via BLE, collects RR interval data,
then sends it to Newton (Archetype AI) for conversational analysis and compares
with the traditional LightGBM stress model.

Experiments:
  1. Zero-shot: Newton interprets raw RR intervals with no context
  2. Conversational: Questions your ML pipeline can't answer
  3. Combined: Newton receives raw data + pre-computed HRV features

Usage:
    source venv/bin/activate
    python newton_experiment.py                       # collect 2 min + analyze
    python newton_experiment.py --duration 60          # collect 1 min
    python newton_experiment.py --file data.csv        # analyze existing CSV
    python newton_experiment.py --device <BLE_ADDR>    # specific device

Requires .env with ATAI_API_KEY and ATAI_API_ENDPOINT.
"""

import argparse
import asyncio
import csv
import json
import os
import signal
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy import signal as scipy_signal
from bleak import BleakClient, BleakScanner
from dotenv import load_dotenv

load_dotenv()

# --- Config ---
DATA_DIR = Path(__file__).parent / "newton_data"
MODELS_DIR = Path(__file__).parent / "models"

HR_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
BODY_SENSOR_LOCATION_UUID = "00002a38-0000-1000-8000-00805f9b34fb"

ATAI_API_KEY = os.getenv("ATAI_API_KEY")
ATAI_API_ENDPOINT = os.getenv("ATAI_API_ENDPOINT")


# =============================================================================
# Phase 1: BLE Data Collection
# =============================================================================

def parse_heart_rate(data: bytearray):
    """Parse BLE Heart Rate Measurement characteristic."""
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
        offset += 2

    rr_intervals_ms = []
    if rr_interval_present:
        while offset + 1 < len(data):
            rr_raw = int.from_bytes(data[offset:offset + 2], byteorder="little")
            rr_ms = (rr_raw / 1024.0) * 1000.0
            if 273 <= rr_ms <= 2000:
                rr_intervals_ms.append(rr_ms)
            offset += 2

    return {
        "heart_rate": heart_rate,
        "sensor_contact": sensor_contact_detected if sensor_contact_supported else None,
        "rr_intervals_ms": rr_intervals_ms,
    }


class HRVCollector:
    """Collects RR interval data from BLE notifications."""

    def __init__(self):
        self.records = []  # list of (unix_timestamp, rr_ms)
        self.prev_data = None
        self.beat_count = 0

    def handle_notification(self, sender, data: bytearray):
        if data == self.prev_data:
            return
        self.prev_data = bytearray(data)

        result = parse_heart_rate(data)
        now = time.time()

        for rr in result["rr_intervals_ms"]:
            self.records.append((now, rr))
            self.beat_count += 1
            hr = round(60000 / rr)
            ts = datetime.now().strftime("%H:%M:%S")
            print(f"\r  [{ts}] HR: {hr} bpm | RR: {rr:.0f} ms | Beats: {self.beat_count}", end="", flush=True)

    def save_csv(self, path: Path) -> Path:
        """Save collected data as CSV."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "rr_interval_ms"])
            for ts, rr in self.records:
                writer.writerow([f"{ts:.3f}", f"{rr:.1f}"])
        return path

    def get_rr_array(self) -> np.ndarray:
        """Get RR intervals as numpy array in ms."""
        return np.array([r[1] for r in self.records])

    def get_timestamps(self) -> np.ndarray:
        """Get timestamps as numpy array in seconds."""
        return np.array([r[0] for r in self.records])


async def find_hr_monitor():
    """Scan for a BLE heart rate monitor."""
    print("Scanning for heart rate monitor (10 seconds)...")
    print("Place your finger on the sensor to activate it.\n")

    devices = await BleakScanner.discover(timeout=10.0, return_adv=True)

    for device, adv_data in devices.values():
        name = device.name or adv_data.local_name or ""
        service_uuids = adv_data.service_uuids or []

        if HR_SERVICE_UUID in service_uuids or "corsense" in name.lower() or "elite" in name.lower():
            print(f"  Found: {name} ({device.address})")
            return device.address

    return None


async def collect_from_ble(duration: int, device_address: str = None) -> HRVCollector:
    """Connect to HR monitor and collect RR data for the specified duration."""
    if not device_address:
        device_address = await find_hr_monitor()
        if not device_address:
            print("\nNo heart rate monitor found. Make sure:")
            print("  1. Your finger is on the sensor (blue LED flashing)")
            print("  2. Bluetooth is enabled")
            sys.exit(1)

    collector = HRVCollector()
    running = True

    def stop():
        nonlocal running
        running = False

    loop = asyncio.get_event_loop()
    loop.add_signal_handler(signal.SIGINT, stop)

    print(f"\nConnecting to {device_address}...")
    async with BleakClient(device_address, timeout=20.0) as client:
        print(f"Connected! Collecting data for {duration} seconds...\n")

        await client.start_notify(HR_MEASUREMENT_UUID, collector.handle_notification)

        start = time.time()
        try:
            while running and client.is_connected and (time.time() - start) < duration:
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                await client.stop_notify(HR_MEASUREMENT_UUID)
            except Exception:
                pass

    print(f"\n\n  Collected {collector.beat_count} beats in {duration}s\n")
    return collector


def load_csv(path: str) -> HRVCollector:
    """Load previously collected CSV into a collector."""
    collector = HRVCollector()
    with open(path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = float(row["timestamp"])
            rr = float(row["rr_interval_ms"])
            collector.records.append((ts, rr))
            collector.beat_count += 1
    print(f"  Loaded {collector.beat_count} beats from {path}\n")
    return collector


# =============================================================================
# Phase 2: Newton Analysis
# =============================================================================

def run_newton_experiments(csv_path: Path, hrv_summary: str):
    """Run all three Newton experiments on the collected data."""
    from archetypeai import ArchetypeAI

    if not ATAI_API_KEY or not ATAI_API_ENDPOINT:
        print("  ERROR: ATAI_API_KEY and ATAI_API_ENDPOINT must be set in .env")
        return

    client = ArchetypeAI(api_key=ATAI_API_KEY, api_endpoint=ATAI_API_ENDPOINT)
    print(f"  Newton client initialized (endpoint: {ATAI_API_ENDPOINT})\n")

    # Upload the CSV file
    print("  Uploading data to Newton...")
    file_response = client.files.local.upload(str(csv_path))
    file_id = file_response["file_id"]
    print(f"  Uploaded: file_id={file_id}\n")

    # --- Experiment 1: Zero-shot interpretation ---
    print("=" * 60)
    print("EXPERIMENT 1: Zero-shot interpretation of raw RR intervals")
    print("=" * 60)

    exp1_queries = [
        "What can you tell me about this data?",
        "Is this person recovered or fatigued?",
        "Describe the autonomic nervous system state reflected in this recording.",
    ]

    for query in exp1_queries:
        print(f"\n  Q: {query}")
        try:
            response = client.capabilities.summarize(query=query, file_ids=[file_id])
            print(f"  A: {response.get('response', response)}")
        except Exception as e:
            print(f"  Error: {e}")
            # Try describe as fallback
            try:
                response = client.capabilities.describe(query=query, file_ids=[file_id])
                print(f"  A (describe): {response.get('response', response)}")
            except Exception as e2:
                print(f"  Describe also failed: {e2}")

    # --- Experiment 2: Conversational queries ---
    print("\n" + "=" * 60)
    print("EXPERIMENT 2: Conversational queries ML can't answer")
    print("=" * 60)

    exp2_queries = [
        "Based on this heart rate variability data, should this person do a hard workout today or take it easy?",
        "What lifestyle factors might explain the patterns you see in this HRV recording?",
        "If this person is an athlete, what does this recording suggest about their training readiness?",
    ]

    for query in exp2_queries:
        print(f"\n  Q: {query}")
        try:
            response = client.capabilities.summarize(query=query, file_ids=[file_id])
            print(f"  A: {response.get('response', response)}")
        except Exception as e:
            print(f"  Error: {e}")

    # --- Experiment 3: Newton + ML features ---
    print("\n" + "=" * 60)
    print("EXPERIMENT 3: Newton + traditional ML features together")
    print("=" * 60)

    exp3_queries = [
        f"Here is RR interval data along with pre-computed HRV metrics:\n{hrv_summary}\nExplain what this means for this person's readiness today.",
        f"Given these HRV metrics:\n{hrv_summary}\nDo you agree with the stress assessment? Why or why not?",
    ]

    for query in exp3_queries:
        # Show shortened version of the query
        display_q = query[:120] + "..." if len(query) > 120 else query
        print(f"\n  Q: {display_q}")
        try:
            response = client.capabilities.summarize(query=query, file_ids=[file_id])
            print(f"  A: {response.get('response', response)}")
        except Exception as e:
            print(f"  Error: {e}")

    # Cleanup
    try:
        client.files.local.delete(file_id)
        print(f"\n  Cleaned up uploaded file {file_id}")
    except Exception:
        pass


def run_newton_lens(csv_path: Path):
    """Alternative: Run Newton analysis using the Lens API with sensor log processor."""
    from archetypeai import ArchetypeAI

    if not ATAI_API_KEY or not ATAI_API_ENDPOINT:
        print("  ERROR: ATAI_API_KEY and ATAI_API_ENDPOINT must be set in .env")
        return

    client = ArchetypeAI(api_key=ATAI_API_KEY, api_endpoint=ATAI_API_ENDPOINT)

    # Upload CSV
    file_response = client.files.local.upload(str(csv_path))
    file_id = file_response["file_id"]

    def session_callback(session_id, session_endpoint, client, args):
        response = client.lens.sessions.process_event(session_id, {"type": "session.validate"})
        assert response["event_data"]["is_valid"], "Session validation failed"

        sse_reader = client.lens.sessions.create_sse_consumer(session_id, max_read_time_sec=120.0)
        print("\n  Newton Lens response:")
        for event in sse_reader.read(block=True):
            if event.get("type") == "inference.result":
                result = event["event_data"].get("response", "")
                print(f"    {result}")
            elif event.get("type") == "error":
                print(f"    Error: {event}")
        sse_reader.close()

    lens_yaml = f"""
   lens_name: HRV Analyzer
   lens_config:
    model_pipeline:
      - processor_name: lens_sensor_logs_processor
    model_parameters:
        model_version: Newton::c2_4_7b_251215a172f6d7
        instruction: You are analyzing heart rate variability (HRV) data from a finger-based PPG sensor. The data contains RR intervals (time between heartbeats) in milliseconds. Analyze the data with the following focus.
        focus: Is this person stressed or relaxed? What is their autonomic nervous system state? Should they do intense exercise or rest today?
        sensor_buffer_size: 20
        input_buffer_step_size: 10
    input_streams:
        - stream_type: csv_file_reader
          stream_config:
            file_id: {file_id}
    output_streams:
        - stream_type: server_sent_events_writer
"""

    print("\n  Running Newton Lens analysis...")
    try:
        client.lens.create_and_run_lens(lens_yaml, session_callback, client=client, args=None)
    except Exception as e:
        print(f"  Lens error: {e}")

    try:
        client.files.local.delete(file_id)
    except Exception:
        pass


# =============================================================================
# Phase 3: Traditional ML Comparison
# =============================================================================

def compute_hrv_features(rr_ms: np.ndarray, timestamps: np.ndarray) -> dict:
    """Compute the same 18 HRV features as the training pipeline."""
    if len(rr_ms) < 10:
        return None

    diffs = np.diff(rr_ms)
    mean_rr = np.mean(rr_ms)
    sdnn = np.std(rr_ms, ddof=1)
    rmssd = np.sqrt(np.mean(diffs ** 2)) if len(diffs) > 0 else 0
    pnn50 = (np.sum(np.abs(diffs) > 50) / len(diffs) * 100) if len(diffs) > 0 else 0
    hr = 60000.0 / rr_ms
    mean_hr = np.mean(hr)
    std_hr = np.std(hr, ddof=1)

    # Poincare
    sd1 = np.std(diffs, ddof=1) / np.sqrt(2) if len(diffs) > 1 else 0
    sums = rr_ms[:-1] + rr_ms[1:]
    sd2 = np.std(sums, ddof=1) / np.sqrt(2) if len(sums) > 1 else 0

    # Frequency domain (Lomb-Scargle)
    ts_rel = timestamps - timestamps[0]
    rr_detrended = rr_ms - mean_rr
    freqs = np.arange(0.04, 0.4, 0.001)

    try:
        pgram = scipy_signal.lombscargle(ts_rel, rr_detrended, 2 * np.pi * freqs, normalize=False)
        lf_mask = (freqs >= 0.04) & (freqs < 0.15)
        hf_mask = (freqs >= 0.15) & (freqs <= 0.4)
        lf = np.trapezoid(pgram[lf_mask], freqs[lf_mask])
        hf = np.trapezoid(pgram[hf_mask], freqs[hf_mask])
        total = np.trapezoid(pgram, freqs)
    except Exception:
        lf, hf, total = 0, 0, 0

    duration = ts_rel[-1] - ts_rel[0] if len(ts_rel) > 1 else 30

    return {
        'mean_rr': mean_rr,
        'sdnn': sdnn,
        'rmssd': rmssd,
        'pnn50': pnn50,
        'mean_hr': mean_hr,
        'std_hr': std_hr,
        'range_rr': np.ptp(rr_ms),
        'median_rr': np.median(rr_ms),
        'cv_rr': sdnn / mean_rr if mean_rr > 0 else 0,
        'sd1': sd1,
        'sd2': sd2,
        'sd1_sd2_ratio': sd1 / sd2 if sd2 > 0 else 0,
        'lf_power': lf,
        'hf_power': hf,
        'lf_hf_ratio': lf / hf if hf > 0 else 0,
        'total_power': total,
        'rr_count': len(rr_ms),
        'rr_coverage': np.sum(rr_ms / 1000) / duration if duration > 0 else 0,
    }


def run_traditional_ml(collector: HRVCollector) -> str:
    """Run HRV feature extraction + LightGBM prediction. Returns summary string."""
    import joblib

    rr_ms = collector.get_rr_array()
    timestamps = collector.get_timestamps()

    if len(rr_ms) < 10:
        print("  Not enough beats for analysis")
        return ""

    features = compute_hrv_features(rr_ms, timestamps)

    # Load model and config
    config = json.loads((MODELS_DIR / "stress_config.json").read_text())
    model = joblib.load(MODELS_DIR / "stress_model.joblib")
    scaler = joblib.load(MODELS_DIR / "stress_scaler.joblib")

    feature_names = config["feature_names"]
    feature_vector = np.array([[features[name] for name in feature_names]])
    scaled = scaler.transform(feature_vector)
    prob = model.predict_proba(scaled)[0][1]
    threshold = config["threshold"]
    prediction = "STRESS" if prob >= threshold else "RELAXED"

    # Print results
    print("=" * 60)
    print("TRADITIONAL ML ANALYSIS (LightGBM)")
    print("=" * 60)
    print(f"\n  Prediction: {prediction} (probability: {prob:.1%}, threshold: {threshold:.0%})")
    print(f"\n  Key HRV Metrics:")
    print(f"    Mean HR:    {features['mean_hr']:.1f} bpm")
    print(f"    Mean RR:    {features['mean_rr']:.1f} ms")
    print(f"    SDNN:       {features['sdnn']:.1f} ms")
    print(f"    RMSSD:      {features['rmssd']:.1f} ms")
    print(f"    pNN50:      {features['pnn50']:.1f}%")
    print(f"    LF/HF:      {features['lf_hf_ratio']:.2f}")
    print(f"    SD1/SD2:    {features['sd1_sd2_ratio']:.2f}")
    print(f"    Beats:      {features['rr_count']:.0f}")

    # Build summary string for Newton Experiment 3
    summary = (
        f"Prediction: {prediction} (stress probability: {prob:.1%})\n"
        f"Mean HR: {features['mean_hr']:.1f} bpm, RMSSD: {features['rmssd']:.1f} ms, "
        f"SDNN: {features['sdnn']:.1f} ms, pNN50: {features['pnn50']:.1f}%, "
        f"LF/HF ratio: {features['lf_hf_ratio']:.2f}, SD1/SD2: {features['sd1_sd2_ratio']:.2f}"
    )
    return summary


# =============================================================================
# Main
# =============================================================================

async def main():
    parser = argparse.ArgumentParser(description="Newton HRV Experiment")
    parser.add_argument("--duration", type=int, default=120, help="Collection duration in seconds (default: 120)")
    parser.add_argument("--device", type=str, help="BLE device address")
    parser.add_argument("--file", type=str, help="Analyze an existing CSV file instead of collecting")
    parser.add_argument("--lens", action="store_true", help="Use Lens API instead of Capabilities API")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("  Newton HRV Experiment")
    print("  CorSense → Newton (Archetype AI) Pipeline")
    print("=" * 60 + "\n")

    # Phase 1: Collect or load data
    if args.file:
        print("--- Phase 1: Loading existing data ---\n")
        collector = load_csv(args.file)
    else:
        print("--- Phase 1: Collecting data from CorSense ---\n")
        collector = await collect_from_ble(args.duration, args.device)

    if collector.beat_count < 10:
        print("Not enough data collected. Try again with longer duration.")
        sys.exit(1)

    # Save CSV
    csv_path = DATA_DIR / f"hrv_{int(time.time())}.csv"
    collector.save_csv(csv_path)
    print(f"  Saved to {csv_path}\n")

    # Phase 3: Traditional ML (run first so we have the summary for Experiment 3)
    print("\n--- Phase 3: Traditional ML Analysis ---\n")
    hrv_summary = run_traditional_ml(collector)

    # Phase 2: Newton analysis
    print("\n\n--- Phase 2: Newton Analysis ---\n")
    if args.lens:
        run_newton_lens(csv_path)
    else:
        run_newton_experiments(csv_path, hrv_summary)

    print("\n" + "=" * 60)
    print("  Experiment complete!")
    print(f"  Data saved: {csv_path}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
