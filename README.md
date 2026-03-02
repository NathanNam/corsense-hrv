# HRV Stress Monitor

Real-time heart rate variability monitoring with ML-based stress detection, running entirely in the browser.

Connect any Bluetooth heart rate monitor, view live HRV metrics, and get stress predictions from a LightGBM model trained on the [WESAD dataset](https://archive.ics.uci.edu/dataset/465/wesad+wearable+stress+and+affect+detection).

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
│   │   ├── stress-chart        # Stress probability over time
│   │   ├── hr-chart            # Heart rate chart
│   │   ├── rr-chart            # RR interval chart
│   │   └── rmssd-chart         # RMSSD chart
│   ├── hooks/
│   │   ├── use-heart-rate      # BLE connection + data streaming
│   │   └── use-stress-prediction # Sliding window + inference
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

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Charts**: Recharts
- **BLE**: Web Bluetooth API
- **ML**: LightGBM (trained in Python, inference in TypeScript)
