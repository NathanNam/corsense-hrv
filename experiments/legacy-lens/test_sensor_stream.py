#!/usr/bin/env python3
"""Test: Can we stream sensor data via WebSocket and have a lens classify it?

This verifies the critical unknown before implementing in TypeScript.
"""

import json
import os
import time
import threading

import requests
import websocket

# Load env
from dotenv import load_dotenv
load_dotenv("web/.env.local")

API_KEY = os.environ.get("ATAI_API_KEY", "")
API_ENDPOINT = os.environ.get("ATAI_API_ENDPOINT", "").rstrip("/")
MACHINE_STATE_LENS = "lns-1d519091822706e2-bc108andqxf8b4os"

assert API_KEY and API_ENDPOINT, "Set ATAI_API_KEY and ATAI_API_ENDPOINT in web/.env.local"

headers = {"Authorization": f"Bearer {API_KEY}"}

# Simulated RR intervals (realistic resting HR ~75bpm)
SIMULATED_RR = [
    800, 820, 790, 810, 830, 800, 815, 795,
    810, 825, 790, 805, 820, 810, 800, 830,
    795, 815, 805, 825, 810, 790, 820, 800,
    815, 830, 795, 810, 805, 820, 790, 815,
    800, 825, 810, 795, 830, 805, 815, 800,
    820, 790, 810, 825, 800, 815, 795, 830,
    810, 805, 820, 790, 815, 800, 825, 810,
    795, 830, 805, 815, 800, 820, 790, 810,
]


def test_sensor_registration():
    """Step 1: Register a sensor."""
    print("\n=== Step 1: Register sensor ===")
    resp = requests.post(
        f"{API_ENDPOINT}/sensors/register",
        headers=headers,
        data=json.dumps({
            "sensor_name": "test_corsense_hrv",
            "sensor_metadata": {"device": "CorSense", "type": "PPG"},
            "topic_ids": ["hrv/rr_interval"],
        }),
    )
    print(f"  Status: {resp.status_code}")
    data = resp.json()
    print(f"  Response: {json.dumps(data, indent=2)}")
    assert resp.status_code in (200, 201), f"Registration failed: {resp.text}"
    return data["stream_uid"], data["sensor_endpoint"]


def test_websocket_handshake(stream_uid, sensor_endpoint):
    """Step 2: Connect WebSocket and handshake."""
    print("\n=== Step 2: WebSocket handshake ===")
    ws_url = f"{sensor_endpoint}/sensors/streamer/{stream_uid}"
    print(f"  Connecting to: {ws_url}")

    ws = websocket.create_connection(ws_url)
    time.sleep(1)  # Post-connect delay (matches SDK)

    # Send handshake
    handshake = {
        "h": "cm",
        "topic_id": "ctl_msg/handshake",
        "data": {},
        "timestamp": time.time(),
    }
    ws.send_binary(json.dumps(handshake).encode())
    response = ws.recv()
    print(f"  Handshake response: {response[:200] if isinstance(response, (str, bytes)) else response}")
    print("  Handshake OK")
    return ws


def test_send_data(ws, stream_uid):
    """Step 3: Stream RR intervals."""
    print("\n=== Step 3: Stream RR intervals ===")
    t = 0
    for i, rr in enumerate(SIMULATED_RR):
        t += rr / 1000
        message = {
            "h": "dm",
            "topic_id": "hrv/rr_interval",
            "data": float(rr),
            "timestamp": t,
            "message_id": i,
            "stream_uid": stream_uid,
        }
        ws.send_binary(json.dumps(message).encode())
        time.sleep(0.05)  # Small delay between messages

    print(f"  Sent {len(SIMULATED_RR)} RR intervals")

    # Send heartbeat to keep alive
    heartbeat = {
        "h": "cm",
        "topic_id": "ctl_msg/heartbeat",
        "data": {},
        "timestamp": time.time(),
    }
    ws.send_binary(json.dumps(heartbeat).encode())
    resp = ws.recv()
    print(f"  Heartbeat response: {resp[:200] if isinstance(resp, (str, bytes)) else resp}")


def test_lens_with_sensor(stream_uid):
    """Step 4: Create lens session reading from sensor stream."""
    print("\n=== Step 4: Lens session with sensor stream ===")

    # Try Machine State Lens first
    print("  Creating Machine State Lens session...")
    resp = requests.post(
        f"{API_ENDPOINT}/lens/sessions/create",
        headers=headers,
        data=json.dumps({"lens_id": MACHINE_STATE_LENS}),
    )
    print(f"  Create session: {resp.status_code} {resp.text[:200]}")
    if resp.status_code != 200:
        print("  FAILED: Could not create lens session")
        return False

    session_data = resp.json()
    session_id = session_data["session_id"]
    print(f"  Session ID: {session_id}")

    try:
        # Try configuring input stream to read from sensor
        print("\n  Configuring input_stream.set with sensor stream...")

        # Attempt 1: sensor_data_reader with stream_uid
        for stream_type in ["sensor_data_reader", "sensor_stream_reader", "sensor_reader"]:
            print(f"\n  Trying stream_type: {stream_type}")
            resp = requests.post(
                f"{API_ENDPOINT}/lens/sessions/events/process",
                headers=headers,
                data=json.dumps({
                    "session_id": session_id,
                    "event": {
                        "type": "input_stream.set",
                        "event_data": {
                            "stream_type": stream_type,
                            "stream_config": {
                                "stream_uid": stream_uid,
                                "window_size": 16,
                                "step_size": 8,
                            },
                        },
                    },
                }),
            )
            print(f"    Status: {resp.status_code} {resp.text[:200]}")
            if resp.status_code == 200:
                print(f"    SUCCESS with {stream_type}!")
                return session_id
    finally:
        pass  # Don't destroy yet if successful

    print("\n  All sensor stream types failed. Trying custom lens approach...")
    # Destroy the failed session
    requests.post(
        f"{API_ENDPOINT}/lens/sessions/destroy",
        headers=headers,
        data=json.dumps({"session_id": session_id}),
    )
    return None


def test_custom_lens_with_sensor(stream_uid):
    """Step 5: Try custom lens with lens_sensor_logs_processor."""
    print("\n=== Step 5: Custom lens with sensor_logs_processor ===")

    lens_config = {
        "lens_name": "test_hrv_streaming",
        "lens_config": {
            "model_pipeline": [
                {"processor_name": "lens_sensor_logs_processor"}
            ],
            "model_parameters": {
                "model_version": "Newton::c2_4_7b_251215a172f6d7",
                "instruction": "Analyze real-time HRV data from a finger-based PPG sensor. The data contains RR intervals in milliseconds.",
                "focus": "Is this person stressed or relaxed?",
                "sensor_buffer_size": 20,
                "input_buffer_step_size": 10,
            },
            "input_streams": [
                {
                    "stream_type": "sensor_data_reader",
                    "stream_config": {
                        "stream_uid": stream_uid,
                    },
                }
            ],
            "output_streams": [
                {"stream_type": "server_sent_events_writer"}
            ],
        },
    }

    print("  Registering custom lens...")
    resp = requests.post(
        f"{API_ENDPOINT}/lens/register",
        headers=headers,
        data=json.dumps({"lens_config": lens_config}),
    )
    print(f"  Register: {resp.status_code} {resp.text[:300]}")

    if resp.status_code not in (200, 201):
        print("  FAILED: Could not register custom lens")

        # Try without sensor input — just register to see if the lens config works
        print("\n  Trying without input_streams to isolate the issue...")
        lens_config_no_input = dict(lens_config)
        lens_config_no_input["lens_config"] = dict(lens_config["lens_config"])
        del lens_config_no_input["lens_config"]["input_streams"]
        resp2 = requests.post(
            f"{API_ENDPOINT}/lens/register",
            headers=headers,
            data=json.dumps({"lens_config": lens_config_no_input}),
        )
        print(f"  Register (no input): {resp2.status_code} {resp2.text[:300]}")
        return None

    lens_data = resp.json()
    lens_id = lens_data.get("lens_id")
    print(f"  Lens ID: {lens_id}")

    # Create session
    print("  Creating session...")
    resp = requests.post(
        f"{API_ENDPOINT}/lens/sessions/create",
        headers=headers,
        data=json.dumps({"lens_id": lens_id}),
    )
    print(f"  Create session: {resp.status_code} {resp.text[:200]}")

    if resp.status_code != 200:
        # Cleanup lens
        requests.post(f"{API_ENDPOINT}/lens/delete", headers=headers, data=json.dumps({"lens_id": lens_id}))
        return None

    session_data = resp.json()
    session_id = session_data["session_id"]
    print(f"  Session ID: {session_id}")

    return {"session_id": session_id, "lens_id": lens_id}


def test_read_sse(session_id, timeout=30):
    """Step 6: Read SSE results from lens session."""
    print(f"\n=== Step 6: Read SSE results (timeout={timeout}s) ===")

    url = f"{API_ENDPOINT}/lens/sessions/consumer/{session_id}"
    print(f"  SSE URL: {url}")

    try:
        resp = requests.get(
            url,
            headers={**headers, "Accept": "text/event-stream"},
            stream=True,
            timeout=timeout,
        )
        print(f"  SSE Status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"  SSE failed: {resp.text[:200]}")
            return []

        results = []
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            print(f"  SSE: {line[:200]}")
            if line.startswith("data:"):
                try:
                    event = json.loads(line[5:].strip())
                    if event.get("type") == "inference.result":
                        results.append(event)
                        print(f"  >>> RESULT: {event['event_data'].get('response', '')}")
                    elif event.get("type") == "sse.stream.end":
                        break
                except json.JSONDecodeError:
                    pass

        print(f"\n  Got {len(results)} results")
        return results

    except requests.exceptions.ReadTimeout:
        print(f"  Timed out after {timeout}s (no results)")
        return []


def cleanup(session_id=None, lens_id=None, ws=None):
    """Cleanup resources."""
    print("\n=== Cleanup ===")
    if session_id:
        resp = requests.post(
            f"{API_ENDPOINT}/lens/sessions/destroy",
            headers=headers,
            data=json.dumps({"session_id": session_id}),
        )
        print(f"  Destroy session: {resp.status_code}")
    if lens_id:
        resp = requests.post(
            f"{API_ENDPOINT}/lens/delete",
            headers=headers,
            data=json.dumps({"lens_id": lens_id}),
        )
        print(f"  Delete lens: {resp.status_code}")
    if ws:
        try:
            ws.close()
            print("  WebSocket closed")
        except Exception:
            pass


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Archetype AI Sensor Streaming → Lens Classification")
    print("=" * 60)
    print(f"Endpoint: {API_ENDPOINT}")

    ws = None
    session_id = None
    lens_id = None

    try:
        # Step 1: Register sensor
        stream_uid, sensor_endpoint = test_sensor_registration()

        # Step 2: WebSocket handshake
        ws = test_websocket_handshake(stream_uid, sensor_endpoint)

        # Step 3: Send data
        test_send_data(ws, stream_uid)

        # Step 4: Try Machine State Lens with sensor input
        result = test_lens_with_sensor(stream_uid)
        if result:
            session_id = result
            # Send more data while lens is running
            test_send_data(ws, stream_uid)
            # Read results
            test_read_sse(session_id)
        else:
            # Step 5: Try custom lens
            result = test_custom_lens_with_sensor(stream_uid)
            if result:
                session_id = result["session_id"]
                lens_id = result["lens_id"]

                # Validate session
                resp = requests.post(
                    f"{API_ENDPOINT}/lens/sessions/events/process",
                    headers=headers,
                    data=json.dumps({
                        "session_id": session_id,
                        "event": {"type": "session.validate"},
                    }),
                )
                print(f"  Validate: {resp.status_code} {resp.text[:200]}")

                # Send more data and read results in parallel
                def send_data_thread():
                    time.sleep(2)
                    test_send_data(ws, stream_uid)

                t = threading.Thread(target=send_data_thread)
                t.start()
                test_read_sse(session_id, timeout=30)
                t.join()
            else:
                print("\n" + "=" * 60)
                print("CONCLUSION: Sensor → Lens streaming NOT supported")
                print("Fallback: periodic auto-queries with existing CSV approach")
                print("=" * 60)

    except Exception as e:
        print(f"\nERROR: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

    finally:
        cleanup(session_id, lens_id, ws)
