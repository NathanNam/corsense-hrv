"""
Extract real WESAD RR intervals for Newton focus CSVs.

Produces two files in web/data/:
  - focus-relaxed.csv  (128 RR intervals from baseline condition, label=1)
  - focus-stressed.csv (128 RR intervals from stress condition, label=2)

Format: timestamp,a1  (cumulative seconds, RR in milliseconds)

Reuses the label/offset logic from train_stress_model.py.
"""

import pickle
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data" / "WESAD"
OUT_DIR = Path(__file__).parent / "web" / "data"
N_INTERVALS = 128
MIN_RR_SEC = 0.3
MAX_RR_SEC = 2.0

# Subjects to try (in order); we pick the first one with enough clean data
SUBJECTS = ["S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9",
            "S10", "S11", "S13", "S14", "S15", "S16", "S17"]

LABEL_BASELINE = 1  # relaxed
LABEL_STRESS = 2    # stressed


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


def extract_segment(subject_id: str, target_label: int):
    """Find N_INTERVALS consecutive RR intervals with the target label."""
    timestamps, ibi_values = load_ibi(subject_id)
    labels, offset = load_labels_and_offset(subject_id)

    # Build list of (ibi_sec,) for intervals matching the target label
    run = []
    for t, ibi in zip(timestamps, ibi_values):
        if get_label(t, labels, offset) == target_label:
            run.append(ibi)
            if len(run) == N_INTERVALS:
                return run
        else:
            run = []
    return None


def write_csv(path: Path, rr_intervals_sec: list[float]):
    """Write Newton-format CSV: timestamp,a1 with RR in milliseconds."""
    lines = ["timestamp,a1"]
    t = 0.0
    for rr in rr_intervals_sec:
        rr_ms = rr * 1000.0
        t += rr
        lines.append(f"{t:.3f},{rr_ms:.1f}")
    path.write_text("\n".join(lines) + "\n")
    print(f"  Wrote {path} ({len(rr_intervals_sec)} intervals)")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for label, name, filename in [
        (LABEL_BASELINE, "relaxed", "focus-relaxed.csv"),
        (LABEL_STRESS, "stressed", "focus-stressed.csv"),
    ]:
        print(f"Extracting {name} (label={label})...")
        segment = None
        for subj in SUBJECTS:
            segment = extract_segment(subj, label)
            if segment is not None:
                print(f"  Found {N_INTERVALS} consecutive intervals from {subj}")
                break
        if segment is None:
            print(f"  ERROR: Could not find {N_INTERVALS} consecutive {name} intervals")
            return
        write_csv(OUT_DIR / filename, segment)

    print("Done!")


if __name__ == "__main__":
    main()
