"""
Extract real WESAD RR intervals for Newton focus CSVs.

Produces two files in web/data/:
  - focus-relaxed.csv  (3 subjects × 128 RR intervals from baseline, label=1)
  - focus-stressed.csv (3 subjects × 128 RR intervals from stress, label=2)

Format: timestamp,a1,rmssd,sdnn,mean_hr,pnn50,sd1
  (cumulative seconds, RR in ms, plus rolling HRV features)

Segments are scored so relaxed examples have low HR / high RMSSD and
stressed examples have high HR / low RMSSD. Top 3 subjects per class.

Reuses the label/offset logic from train_stress_model.py.
"""

import math
import pickle
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data" / "WESAD"
OUT_DIR = Path(__file__).parent / "web" / "data"
N_INTERVALS = 128
MIN_RR_SEC = 0.3
MAX_RR_SEC = 2.0
N_SUBJECTS = 3  # top N subjects per class

SUBJECTS = ["S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9",
            "S10", "S11", "S13", "S14", "S15", "S16", "S17"]

LABEL_BASELINE = 1  # relaxed
LABEL_STRESS = 2    # stressed

ROLLING_WINDOW = 16


# --- Data loading (reused from train_stress_model.py) ---

def load_ibi(subject_id: str):
    """Load IBI data. Returns (timestamps, ibi_values) in seconds."""
    path = DATA_DIR / subject_id / f"{subject_id}_E4_Data" / "IBI.csv"
    timestamps, values = [], []
    with open(path) as f:
        f.readline()  # skip header line (unix timestamp, IBI)
        for line in f:
            parts = line.strip().split(",")
            if len(parts) == 2:
                t, ibi = float(parts[0]), float(parts[1])
                if MIN_RR_SEC <= ibi <= MAX_RR_SEC:
                    timestamps.append(t)
                    values.append(ibi)
    return timestamps, values


def load_labels_and_offset(subject_id: str):
    """Load labels from pickle and compute E4-to-RespiBAN time offset."""
    pkl_path = DATA_DIR / subject_id / f"{subject_id}.pkl"
    with open(pkl_path, "rb") as f:
        data = pickle.load(f, encoding="latin1")
    labels = data["label"]
    label_dur = len(labels) / 700.0
    wrist_dur = len(data["signal"]["wrist"]["BVP"]) / 64.0
    offset = label_dur - wrist_dur
    return labels, offset


def get_label(t_sec: float, labels, offset: float) -> int:
    idx = int((t_sec + offset) * 700)
    if 0 <= idx < len(labels):
        return int(labels[idx])
    return 0


# --- Segment finding and scoring ---

def find_all_segments(subject_id: str, target_label: int):
    """Find ALL valid N_INTERVALS consecutive RR runs for the target label."""
    timestamps, ibi_values = load_ibi(subject_id)
    labels, offset = load_labels_and_offset(subject_id)

    segments = []
    run = []
    for t, ibi in zip(timestamps, ibi_values):
        if get_label(t, labels, offset) == target_label:
            run.append(ibi)
            if len(run) == N_INTERVALS:
                segments.append(list(run))
                run = run[N_INTERVALS // 2:]  # slide by half for overlapping candidates
        else:
            run = []
    return segments


def segment_stats(rr_sec: list[float]):
    """Compute mean HR (bpm) and mean RMSSD (ms) for a segment."""
    rr_ms = [r * 1000.0 for r in rr_sec]
    mean_hr = sum(60000.0 / r for r in rr_ms) / len(rr_ms)
    diffs = [rr_ms[i] - rr_ms[i - 1] for i in range(1, len(rr_ms))]
    rmssd = math.sqrt(sum(d * d for d in diffs) / len(diffs)) if diffs else 0.0
    return mean_hr, rmssd


def find_best_segments(target_label: int, is_stressed: bool):
    """Find best segment per subject, return top N_SUBJECTS by score."""
    candidates = []  # (score, subject_id, segment, mean_hr, rmssd)

    for subj in SUBJECTS:
        segments = find_all_segments(subj, target_label)
        if not segments:
            continue
        best_score = None
        best = None
        for seg in segments:
            mean_hr, rmssd = segment_stats(seg)
            # Stressed: want high HR, low RMSSD
            # Relaxed: want low HR, high RMSSD
            score = (mean_hr - rmssd) if is_stressed else (rmssd - mean_hr)
            if best_score is None or score > best_score:
                best_score = score
                best = (score, subj, seg, mean_hr, rmssd)
        if best is not None:
            candidates.append(best)

    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[:N_SUBJECTS]


# --- Rolling features ---

def compute_rolling_features(rr_intervals_ms: list[float]):
    """Compute rolling HRV features (rmssd, sdnn, mean_hr, pnn50, sd1) per beat."""
    results = []
    for i in range(len(rr_intervals_ms)):
        window = rr_intervals_ms[max(0, i - ROLLING_WINDOW + 1): i + 1]
        if len(window) < 2:
            results.append((0.0, 0.0, 0.0, 0.0, 0.0))
            continue
        diffs = [window[j] - window[j - 1] for j in range(1, len(window))]
        mean_rr = sum(window) / len(window)
        rmssd = math.sqrt(sum(d * d for d in diffs) / len(diffs))
        var = sum((v - mean_rr) ** 2 for v in window) / (len(window) - 1)
        sdnn = math.sqrt(var)
        mean_hr = sum(60000.0 / v for v in window) / len(window)
        pnn50 = sum(1 for d in diffs if abs(d) > 50) / len(diffs) * 100
        diff_mean = sum(diffs) / len(diffs)
        diff_var = sum((d - diff_mean) ** 2 for d in diffs) / (len(diffs) - 1) if len(diffs) > 1 else 0.0
        sd1 = math.sqrt(diff_var) / math.sqrt(2)
        results.append((rmssd, sdnn, mean_hr, pnn50, sd1))
    return results


# --- CSV output ---

def write_csv(path: Path, segments: list[list[float]]):
    """Write Newton-format CSV from multiple segments (each in seconds)."""
    lines = ["timestamp,a1,rmssd,sdnn,mean_hr,pnn50,sd1"]
    t = 0.0
    total_rows = 0
    for seg in segments:
        rr_ms = [rr * 1000.0 for rr in seg]
        features = compute_rolling_features(rr_ms)
        for rr_s, rr_m, (rmssd, sdnn, mean_hr, pnn50, sd1) in zip(seg, rr_ms, features):
            t += rr_s
            lines.append(f"{t:.3f},{rr_m:.1f},{rmssd:.1f},{sdnn:.1f},{mean_hr:.1f},{pnn50:.1f},{sd1:.1f}")
            total_rows += 1
    path.write_text("\n".join(lines) + "\n")
    print(f"  Wrote {path} ({total_rows} rows from {len(segments)} segments)")


# --- Main ---

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for label, name, filename, is_stressed in [
        (LABEL_BASELINE, "relaxed", "focus-relaxed.csv", False),
        (LABEL_STRESS, "stressed", "focus-stressed.csv", True),
    ]:
        print(f"\nExtracting {name} (label={label})...")
        best = find_best_segments(label, is_stressed)
        if not best:
            print(f"  ERROR: No segments found for {name}")
            return

        print(f"  {'Subject':<10s} {'HR (bpm)':>10s} {'RMSSD (ms)':>12s} {'Score':>8s}")
        print(f"  {'-'*10} {'-'*10} {'-'*12} {'-'*8}")
        segments = []
        for score, subj, seg, mean_hr, rmssd in best:
            print(f"  {subj:<10s} {mean_hr:>10.1f} {rmssd:>12.1f} {score:>8.1f}")
            segments.append(seg)

        write_csv(OUT_DIR / filename, segments)

    print("\nDone!")


if __name__ == "__main__":
    main()
