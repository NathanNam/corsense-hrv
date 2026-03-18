# HRV Stress Monitor

Real-time heart rate variability monitoring with ML-based stress detection, running entirely in the browser.

Connect any Bluetooth heart rate monitor, view live HRV metrics, and get stress predictions from a LightGBM model trained on the [WESAD dataset](https://archive.ics.uci.edu/dataset/465/wesad+wearable+stress+and+affect+detection). Optionally, ask **Newton** (powered by [Archetype AI](https://www.archetypeai.app/)) natural language questions about your HRV data.

## How It Works

1. Connects to a BLE heart rate monitor via Web Bluetooth
2. Streams RR intervals (beat-to-beat timing) in real-time
3. Computes 18 HRV features from a 30-second sliding window:
   - **Time-domain**: mean RR, SDNN, RMSSD, pNN50, heart rate stats
   - **Non-linear**: Poincare SD1/SD2
   - **Frequency-domain**: LF/HF power via Lomb-Scargle periodogram
4. Runs the features through 100 LightGBM decision trees (in-browser, no server)
5. Classifies as **Relaxed** or **Stress Detected** based on an optimized threshold

## Quick Start

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:3000** in Chrome or Edge (Web Bluetooth is not supported in Firefox/Safari).

Click **Connect HR Monitor** and select your device from the browser's Bluetooth picker.

### Enabling Newton (optional)

To enable the conversational AI panel, create `web/.env.local` with your [Archetype AI](https://console.u1.archetypeai.app/) credentials:

```
ATAI_API_KEY=your_api_key
ATAI_API_ENDPOINT=https://api.u1.archetypeai.app/v0.5
```

When configured, an **Ask Newton** chat panel appears on the right side after you connect a device. You can ask questions like "Am I stressed?", "Should I work out today?", or "Explain my HRV". Without these keys, the app works exactly as before.

## Compatible Devices

Any Bluetooth Low Energy heart rate monitor that supports the standard [Heart Rate Profile](https://www.bluetooth.com/specifications/specs/heart-rate-profile-1-0/) and reports RR intervals, including:

- Elite CorSense / HRV Sensor
- Polar H10 / H9 / Verity Sense
- Garmin HRM-Pro / HRM-Dual
- Wahoo TICKR / TICKR FIT
- CooSpo / Magene chest straps

## Project Structure

```
hrv/
├── web/                        # Next.js app (what users run)
│   ├── app/page.tsx            # Main dashboard
│   ├── components/             # UI components
│   │   ├── connection-panel    # BLE connect/disconnect
│   │   ├── heart-rate-display  # Live HR + RMSSD display
│   │   ├── stress-indicator    # Stress prediction card
│   │   ├── newton-chat         # Newton conversational AI panel
│   │   ├── stress-chart        # Stress probability over time
│   │   ├── hr-chart            # Heart rate chart
│   │   ├── rr-chart            # RR interval chart
│   │   └── rmssd-chart         # RMSSD chart
│   ├── hooks/
│   │   ├── use-heart-rate      # BLE connection + data streaming
│   │   ├── use-stress-prediction # Sliding window + inference
│   │   └── use-newton          # Newton chat state + API calls
│   ├── app/api/newton/         # Newton API routes (server-side)
│   │   ├── status/route.ts     # GET — checks if Newton is configured
│   │   └── query/route.ts      # POST — classifies RR data via Archetype AI
│   └── lib/
│       ├── ble-constants       # Standard BLE UUIDs
│       ├── parse-heart-rate    # BLE characteristic parser
│       ├── hrv.ts              # RMSSD calculation
│       ├── hrv-features        # Full 18-feature extraction
│       ├── stress-predictor    # LightGBM tree traversal
│       └── stress-model-data.json # Exported model trees + scaler
│
├── models/                     # Trained model files
│   ├── stress_model.joblib     # LightGBM model (Python)
│   ├── stress_scaler.joblib    # StandardScaler (Python)
│   └── stress_config.json      # Config, metrics, feature importances
│
├── train_stress_model.py       # Training pipeline (WESAD dataset)
└── export_model_trees.py       # Export model to JSON for browser
```

## Model Details

- **Algorithm**: LightGBM (100 trees, max depth 3, learning rate 0.05)
- **Training**: Leave-One-Subject-Out cross-validation on 15 WESAD subjects
- **Task**: Binary classification — stress vs non-stress (baseline + amusement)
- **Threshold**: 0.29 (optimized for F1)

| Metric    | Value |
|-----------|-------|
| AUC       | 0.708 |
| F1        | 0.575 |
| Accuracy  | 0.618 |
| Precision | 0.456 |
| Recall    | 0.778 |

Top features by importance: mean RR, rr_coverage, mean HR, HF power, SD2.

## Retraining the Model

To retrain on the WESAD dataset:

1. Download from [Kaggle](https://www.kaggle.com/datasets/orvile/wesad-wearable-stress-affect-detection-dataset?resource=download) (also available from [UCI](https://archive.ics.uci.edu/dataset/465/wesad+wearable+stress+and+affect+detection))
2. Extract to `data/WESAD/` so the structure is `data/WESAD/S2/`, `data/WESAD/S3/`, etc.

```bash

python3 -m venv venv
source venv/bin/activate
pip install numpy scipy pandas scikit-learn joblib xgboost lightgbm

python train_stress_model.py      # Train + export to models/
python export_model_trees.py      # Convert to JSON for browser
```

## Newton (Archetype AI)

When enabled, the **Ask Newton** chat panel uses Archetype AI's [Machine State Lens](https://docs.archetypeai.app/) — a pre-built n-shot classifier that compares live RR interval patterns against labeled "relaxed" and "stressed" reference examples to classify the user's current autonomic state.

Newton is **entirely optional**. Without `ATAI_API_KEY` and `ATAI_API_ENDPOINT` in `web/.env.local`, the app works fully — the Newton panel simply doesn't appear. The `/api/newton/status` endpoint returns `available: false`, and the frontend hides the panel.

### Archetype AI API flow (7 API calls per query)

**Step 1 — Upload files** (`POST /files`, 1-3 calls)

Three CSV files are uploaded as multipart form data:

- **`focus-relaxed.csv`** — 384 rows of real WESAD RR intervals from 3 subjects during baseline (label=1), with pre-computed rolling HRV features
- **`focus-stressed.csv`** — 384 rows from 3 subjects during stress (label=2), same format
- **User data CSV** — live RR intervals from the connected sensor, with the same rolling features computed on-the-fly by `computeRollingFeatures()`

The focus files are **cached** at module scope (`cachedFocusFiles`) — uploaded once and reused across queries. Only the user data CSV is uploaded per query.

CSV columns: `timestamp, a1 (raw RR ms), rmssd, sdnn, mean_hr, pnn50, sd1` — all computed over a trailing 16-beat window.

**Step 2 — Create lens session** (`POST /lens/sessions/create`, 1 call)

```json
{ "lens_id": "lns-1d519091822706e2-bc108andqxf8b4os" }
```

Returns a `session_id` used for all subsequent calls.

**Step 3 — Configure the session** (`POST /lens/sessions/events/process`, 3 calls)

Three sequential events configure the session:

- **`session.modify`** — Sets the n-shot examples (relaxed/stressed file IDs) and CSV parsing config (which columns to use, window size 16, step size 8)
- **`input_stream.set`** — Points the lens at the user's uploaded CSV via `csv_file_reader`
- **`output_stream.set`** — Tells the lens to emit results via `server_side_events_writer`

**Step 4 — Read classification results** (SSE stream via `GET /lens/sessions/consumer/{session_id}`)

The lens processes the user CSV in sliding windows (16 beats wide, 8 beat step) and emits `inference.result` events, each containing a classification label and confidence scores:

```json
{ "type": "inference.result", "event_data": { "response": ["relaxed", {"relaxed": 0.6, "stressed": 0.4}] } }
```

The stream ends with an `sse.stream.end` event.

**Step 5 — Aggregate and respond** (client-side, no API call)

`buildResponse()` aggregates votes across all windows (e.g., 7 windows with overlapping step=8), computes stressed/relaxed percentages, then generates a templated natural-language response based on keyword matching the user's question ("stress", "work out", "explain", etc.) and injecting HRV metrics from the in-browser LightGBM model (heart rate, RMSSD, stress probability).

**Step 6 — Cleanup** (2 fire-and-forget calls)

- `POST /lens/sessions/destroy` — tears down the session
- `DELETE /files/delete/{file_id}` — deletes the user's per-query CSV (focus files stay cached)

### Two ML models in parallel

The app runs two independent stress classifiers:

| | LightGBM (in-browser) | Newton (Archetype AI) |
|---|---|---|
| **Runs** | Client-side, real-time | Server-side, per query |
| **Approach** | 100-tree gradient boosting on 18 HRV features | N-shot classification via Machine State Lens |
| **Latency** | Instant (every new RR interval) | ~10-15 seconds per query |
| **Confidence** | Typically 70-95% | Typically 54-60% |
| **Requires API** | No | Yes (Archetype AI credentials) |

They sometimes disagree — Newton's n-shot classification has a lower confidence ceiling than the trained LightGBM model.

### Focus data

The focus CSVs (`web/data/focus-relaxed.csv`, `web/data/focus-stressed.csv`) contain real physiological data from the WESAD dataset, selected by scoring segments for physiological correctness:

- **Relaxed**: high RMSSD, low heart rate (score = RMSSD - mean HR)
- **Stressed**: high heart rate, low RMSSD (score = mean HR - RMSSD)

Top 3 subjects per class are selected and concatenated (128 beats each = 384 rows per file). To regenerate from WESAD source data, run `python extract_focus_csv.py`.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Charts**: Recharts
- **BLE**: Web Bluetooth API
- **ML (local)**: LightGBM (trained in Python, inference in TypeScript)
- **ML (cloud, optional)**: Archetype AI Machine State Lens
