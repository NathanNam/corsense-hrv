"""Test the Activity Monitor lens with HRV CSV data.

The Activity Monitor uses the Newton generative model which has
`instruction` and `focus` fields — it can answer questions.
Let's see if it works with CSV time-series data instead of video.
"""

import os
import json
import time
import requests
from pathlib import Path

API_KEY = os.environ.get("ATAI_API_KEY")
ENDPOINT = os.environ.get("ATAI_API_ENDPOINT", "https://api.u1.archetypeai.app/v0.5")
ACTIVITY_MONITOR_LENS = "lns-fd669361822b07e2-bc608aa3fdf8b4f9"

headers = {"Authorization": f"Bearer {API_KEY}"}


def upload_csv(name: str, content: str) -> str:
    res = requests.post(
        f"{ENDPOINT}/files",
        headers=headers,
        files={"file": (name, content, "text/csv")},
    )
    res.raise_for_status()
    return res.json()["file_id"]


def api_post(path: str, body: dict) -> dict:
    res = requests.post(
        f"{ENDPOINT}/{path}",
        headers=headers,
        json=body,
    )
    if not res.ok:
        print(f"  ERROR {path}: {res.status_code} {res.text[:200]}")
    res.raise_for_status()
    return res.json()


def read_sse(session_id: str, timeout: int = 60) -> list[dict]:
    """Read SSE events from a lens session."""
    url = f"{ENDPOINT}/lens/sessions/consumer/{session_id}"
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
                print(f"  [event] {etype}: {json.dumps(event.get('event_data', {}))[:100]}")
        except json.JSONDecodeError:
            pass

    return results


def test_with_csv(question: str):
    """Try Activity Monitor lens with CSV data and a custom question."""
    print(f"\n{'='*60}")
    print(f"Question: {question}")
    print(f"{'='*60}")

    # Build a small HRV CSV
    csv_lines = ["timestamp,a1,rmssd,sdnn,mean_hr,pnn50,sd1"]
    rr_values = [810, 795, 820, 805, 830, 815, 790, 825, 800, 835,
                 810, 795, 820, 805, 830, 815, 790, 825, 800, 835,
                 750, 740, 760, 730, 770, 745, 755, 735, 765, 725,
                 810, 795]
    t = 0
    for rr in rr_values:
        t += rr / 1000
        csv_lines.append(f"{t:.3f},{rr:.1f},45.0,35.0,74.0,15.0,22.0")
    csv_content = "\n".join(csv_lines)

    # Upload CSV
    print("\n1. Uploading CSV...")
    file_id = upload_csv("hrv_test.csv", csv_content)
    print(f"   file_id: {file_id}")

    # Create session with Activity Monitor
    print("\n2. Creating Activity Monitor session...")
    session = api_post("lens/sessions/create", {"lens_id": ACTIVITY_MONITOR_LENS})
    session_id = session["session_id"]
    print(f"   session_id: {session_id}")

    try:
        # Configure with custom focus and instruction
        print("\n3. Configuring session (focus + instruction)...")
        api_post("lens/sessions/events/process", {
            "session_id": session_id,
            "event": {
                "type": "session.modify",
                "event_data": {
                    "focus": "Analyze heart rate variability (HRV) data from a finger sensor. "
                             "The CSV contains RR intervals (beat-to-beat timing in ms) and derived metrics: "
                             "RMSSD, SDNN, mean heart rate, pNN50, and SD1.",
                    "instruction": question,
                    "csv_configs": {
                        "timestamp_column": "timestamp",
                        "data_columns": ["a1", "rmssd", "sdnn", "mean_hr", "pnn50", "sd1"],
                        "window_size": 16,
                        "step_size": 8,
                    },
                },
            },
        })

        # Set input stream
        print("\n4. Setting input stream (CSV)...")
        api_post("lens/sessions/events/process", {
            "session_id": session_id,
            "event": {
                "type": "input_stream.set",
                "event_data": {
                    "stream_type": "csv_file_reader",
                    "stream_config": {
                        "file_id": file_id,
                        "window_size": 16,
                        "step_size": 8,
                        "loop_recording": False,
                        "output_format": "",
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
        results = read_sse(session_id, timeout=60)
        elapsed = time.time() - t0
        print(f"\n   Got {len(results)} results in {elapsed:.1f}s")

    finally:
        # Cleanup
        api_post("lens/sessions/destroy", {"session_id": session_id})
        requests.delete(
            f"{ENDPOINT}/files/delete/{file_id}",
            headers=headers,
        )
        print("\n   Cleaned up.")


if __name__ == "__main__":
    if not API_KEY:
        # Try loading from .env.local
        env_path = Path(__file__).parent / "web" / ".env.local"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()
            API_KEY = os.environ.get("ATAI_API_KEY")
            ENDPOINT = os.environ.get("ATAI_API_ENDPOINT", ENDPOINT)
            headers["Authorization"] = f"Bearer {API_KEY}"

    test_with_csv("Are there any anomalies in this heart rate data?")
    test_with_csv("Is this person stressed or relaxed based on the HRV metrics?")
    test_with_csv("Summarize the heart rate variability patterns.")
