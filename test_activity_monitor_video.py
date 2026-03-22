#!/usr/bin/env python3
"""Test: Can the Activity Monitor lens process a video/image of HRV charts?

The Activity Monitor uses lens_camera_processor (Newton generative model).
It has `instruction` and `focus` fields — it can answer questions.
But it expects video/camera input, not CSV.

Approach: Generate a chart image from HRV data, convert to video, upload, feed to lens.
"""

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import requests

# Load env
env_path = Path(__file__).parent / "web" / ".env.local"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip()

API_KEY = os.environ.get("ATAI_API_KEY", "")
API_ENDPOINT = os.environ.get("ATAI_API_ENDPOINT", "").rstrip("/")
ACTIVITY_MONITOR_LENS = "lns-fd669361822b07e2-bc608aa3fdf8b4f9"

assert API_KEY and API_ENDPOINT, "Set ATAI_API_KEY and ATAI_API_ENDPOINT"

headers = {"Authorization": f"Bearer {API_KEY}"}

# Simulated HRV data
RR_VALUES = [
    810, 795, 820, 805, 830, 815, 790, 825, 800, 835,
    810, 795, 820, 805, 830, 815, 790, 825, 800, 835,
    750, 740, 760, 730, 770, 745, 755, 735, 765, 725,
    810, 795, 820, 805, 830, 815, 790, 825, 800, 835,
    810, 795, 820, 805, 830, 815, 790, 825, 800, 835,
    750, 740, 760, 730, 770, 745, 755, 735, 765, 725,
    810, 795, 820, 805,
]


def generate_hrv_chart(output_path: str):
    """Generate an HRV chart image using matplotlib."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np

    fig, axes = plt.subplots(2, 2, figsize=(12, 8))
    fig.suptitle("HRV Dashboard — Real-time Heart Rate Variability", fontsize=14, fontweight='bold')

    # Compute timestamps
    timestamps = []
    t = 0
    for rr in RR_VALUES:
        t += rr / 1000
        timestamps.append(t)

    # 1. RR Intervals
    ax = axes[0, 0]
    ax.plot(timestamps, RR_VALUES, 'b-', linewidth=1.5)
    ax.set_title("RR Intervals")
    ax.set_ylabel("RR (ms)")
    ax.set_xlabel("Time (s)")
    ax.grid(True, alpha=0.3)

    # 2. Heart Rate
    hr_values = [60000 / rr for rr in RR_VALUES]
    ax = axes[0, 1]
    ax.plot(timestamps, hr_values, 'r-', linewidth=1.5)
    ax.set_title("Heart Rate")
    ax.set_ylabel("BPM")
    ax.set_xlabel("Time (s)")
    ax.grid(True, alpha=0.3)

    # 3. RMSSD (rolling 16-beat window)
    rmssd_values = []
    for i in range(len(RR_VALUES)):
        start = max(0, i - 15)
        window = RR_VALUES[start:i+1]
        if len(window) < 2:
            rmssd_values.append(0)
        else:
            diffs = [window[j+1] - window[j] for j in range(len(window)-1)]
            rmssd = (sum(d**2 for d in diffs) / len(diffs)) ** 0.5
            rmssd_values.append(rmssd)

    ax = axes[1, 0]
    ax.plot(timestamps, rmssd_values, 'g-', linewidth=1.5)
    ax.set_title("RMSSD (16-beat window)")
    ax.set_ylabel("RMSSD (ms)")
    ax.set_xlabel("Time (s)")
    ax.grid(True, alpha=0.3)

    # 4. Stress indicator text
    ax = axes[1, 1]
    ax.axis('off')
    mean_rr = np.mean(RR_VALUES)
    mean_hr = np.mean(hr_values)
    mean_rmssd = np.mean(rmssd_values[-16:])
    sdnn = np.std(RR_VALUES)

    info_text = (
        f"Summary Metrics\n\n"
        f"Mean RR: {mean_rr:.0f} ms\n"
        f"Mean HR: {mean_hr:.1f} bpm\n"
        f"RMSSD: {mean_rmssd:.1f} ms\n"
        f"SDNN: {sdnn:.1f} ms\n"
        f"Total beats: {len(RR_VALUES)}\n"
        f"Duration: {timestamps[-1]:.1f} s\n\n"
        f"Note: RR interval drop at ~20-30s\n"
        f"may indicate sympathetic activation"
    )
    ax.text(0.1, 0.9, info_text, transform=ax.transAxes,
            fontsize=12, verticalalignment='top', fontfamily='monospace',
            bbox=dict(boxstyle='round', facecolor='lightyellow', alpha=0.8))

    plt.tight_layout()
    plt.savefig(output_path, dpi=100, bbox_inches='tight')
    plt.close()
    print(f"  Chart saved to {output_path}")


def image_to_video(image_path: str, video_path: str, duration: int = 5):
    """Convert a static image to a short video using ffmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", image_path,
        "-c:v", "libx264",
        "-t", str(duration),
        "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-r", "1",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ffmpeg error: {result.stderr[:200]}")
        raise RuntimeError("ffmpeg failed")
    print(f"  Video saved to {video_path}")


def upload_file(path: str, content_type: str) -> str:
    """Upload a file to Archetype AI."""
    name = os.path.basename(path)
    with open(path, "rb") as f:
        res = requests.post(
            f"{API_ENDPOINT}/files",
            headers=headers,
            files={"file": (name, f, content_type)},
        )
    res.raise_for_status()
    file_id = res.json()["file_id"]
    print(f"  Uploaded {name} -> {file_id}")
    return file_id


def api_post(path: str, body: dict) -> dict:
    res = requests.post(
        f"{API_ENDPOINT}/{path}",
        headers=headers,
        json=body,
    )
    if not res.ok:
        print(f"  ERROR {path}: {res.status_code} {res.text[:300]}")
    res.raise_for_status()
    return res.json()


def read_sse(session_id: str, timeout: int = 60) -> list[dict]:
    """Read SSE events from a lens session."""
    url = f"{API_ENDPOINT}/lens/sessions/consumer/{session_id}"
    res = requests.get(
        url,
        headers={**headers, "Accept": "text/event-stream"},
        stream=True,
        timeout=timeout,
    )
    if not res.ok:
        print(f"  SSE failed: {res.status_code}")
        return []

    results = []
    for line in res.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[5:].strip())
            etype = event.get("type", "")
            if etype == "inference.result":
                resp = event.get("event_data", {}).get("response")
                print(f"  [result] {resp}")
                results.append(event)
            elif etype == "sse.stream.end":
                print("  [stream end]")
                break
            else:
                print(f"  [event] {etype}: {json.dumps(event.get('event_data', {}))[:120]}")
        except json.JSONDecodeError:
            pass

    return results


def test_with_video(question: str, video_path: str, stream_type: str):
    """Try Activity Monitor lens with video input."""
    print(f"\n{'='*60}")
    print(f"Question: {question}")
    print(f"Stream type: {stream_type}")
    print(f"{'='*60}")

    # Upload video
    print("\n1. Uploading video...")
    file_id = upload_file(video_path, "video/mp4")

    # Create session
    print("\n2. Creating Activity Monitor session...")
    session = api_post("lens/sessions/create", {"lens_id": ACTIVITY_MONITOR_LENS})
    session_id = session["session_id"]
    print(f"   session_id: {session_id}")

    try:
        # Configure with focus + instruction
        print("\n3. Configuring session (focus + instruction)...")
        api_post("lens/sessions/events/process", {
            "session_id": session_id,
            "event": {
                "type": "session.modify",
                "event_data": {
                    "focus": (
                        "This is a heart rate variability (HRV) monitoring dashboard. "
                        "It shows real-time charts of RR intervals (beat-to-beat timing in milliseconds), "
                        "heart rate in BPM, and RMSSD (a measure of heart rate variability). "
                        "The dashboard is used for stress detection and autonomic nervous system monitoring."
                    ),
                    "instruction": question,
                },
            },
        })

        # Set input stream
        print(f"\n4. Setting input stream ({stream_type})...")
        api_post("lens/sessions/events/process", {
            "session_id": session_id,
            "event": {
                "type": "input_stream.set",
                "event_data": {
                    "stream_type": stream_type,
                    "stream_config": {
                        "file_id": file_id,
                    },
                },
            },
        })

        # Set output stream
        print("\n5. Setting output stream (SSE)...")
        api_post("lens/sessions/events/process", {
            "session_id": session_id,
            "event": {
                "type": "output_stream.set",
                "event_data": {
                    "stream_type": "server_side_events_writer",
                    "stream_config": {},
                },
            },
        })

        # Read results
        print("\n6. Reading SSE results...")
        t0 = time.time()
        results = read_sse(session_id, timeout=90)
        elapsed = time.time() - t0
        print(f"\n   Got {len(results)} results in {elapsed:.1f}s")
        return results

    finally:
        api_post("lens/sessions/destroy", {"session_id": session_id})
        requests.delete(f"{API_ENDPOINT}/files/delete/{file_id}", headers=headers)
        print("   Cleaned up.")


def test_with_image(question: str, image_path: str):
    """Try Activity Monitor lens with a direct image upload (no video conversion)."""
    print(f"\n{'='*60}")
    print(f"Question: {question}")
    print(f"Input: image directly (no video)")
    print(f"{'='*60}")

    # Upload image
    print("\n1. Uploading image...")
    file_id = upload_file(image_path, "image/png")

    # Create session
    print("\n2. Creating Activity Monitor session...")
    session = api_post("lens/sessions/create", {"lens_id": ACTIVITY_MONITOR_LENS})
    session_id = session["session_id"]
    print(f"   session_id: {session_id}")

    try:
        # Configure
        print("\n3. Configuring session...")
        api_post("lens/sessions/events/process", {
            "session_id": session_id,
            "event": {
                "type": "session.modify",
                "event_data": {
                    "focus": (
                        "This is a heart rate variability (HRV) monitoring dashboard. "
                        "It shows real-time charts of RR intervals, heart rate, and RMSSD."
                    ),
                    "instruction": question,
                },
            },
        })

        # Try video_file_reader with the image
        for stream_type in ["video_file_reader", "image_file_reader", "file_reader"]:
            print(f"\n4. Trying input stream: {stream_type}...")
            try:
                api_post("lens/sessions/events/process", {
                    "session_id": session_id,
                    "event": {
                        "type": "input_stream.set",
                        "event_data": {
                            "stream_type": stream_type,
                            "stream_config": {"file_id": file_id},
                        },
                    },
                })
                print(f"   {stream_type} accepted!")

                # Set output
                api_post("lens/sessions/events/process", {
                    "session_id": session_id,
                    "event": {
                        "type": "output_stream.set",
                        "event_data": {
                            "stream_type": "server_side_events_writer",
                            "stream_config": {},
                        },
                    },
                })

                # Read results
                print("\n5. Reading SSE results...")
                t0 = time.time()
                results = read_sse(session_id, timeout=60)
                elapsed = time.time() - t0
                print(f"   Got {len(results)} results in {elapsed:.1f}s")
                if results:
                    return results

            except Exception as e:
                print(f"   {stream_type} failed: {e}")
                continue

        return []

    finally:
        api_post("lens/sessions/destroy", {"session_id": session_id})
        requests.delete(f"{API_ENDPOINT}/files/delete/{file_id}", headers=headers)
        print("   Cleaned up.")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmpdir:
        image_path = os.path.join(tmpdir, "hrv_chart.png")
        video_path = os.path.join(tmpdir, "hrv_chart.mp4")

        # Generate chart
        print("=== Generating HRV chart ===")
        generate_hrv_chart(image_path)

        # Convert to video
        print("\n=== Converting to video ===")
        try:
            image_to_video(image_path, video_path, duration=5)
            has_video = True
        except Exception as e:
            print(f"  ffmpeg not available: {e}")
            has_video = False

        # Test 1: Try video_file_reader with actual video
        if has_video:
            test_with_video(
                "What patterns do you see in this heart rate data? Is the person stressed or relaxed?",
                video_path,
                "video_file_reader",
            )

        # Test 2: Try different stream types with image
        test_with_image(
            "Analyze this HRV dashboard. Is the person stressed or relaxed?",
            image_path,
        )
