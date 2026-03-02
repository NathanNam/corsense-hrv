"""
WESAD Stress Detection from HRV Features (v3)
==============================================
Train ML models to classify stress vs non-stress from heart rate variability
features derived from RR intervals (IBI data from Empatica E4 wrist sensor).

Features:
  - AUC-ROC metric + threshold optimization
  - Window size search (30s, 60s, 120s)
  - Hyperparameter grid search within LOSO CV
  - Feature selection (mutual information)
  - 8 model types: LogReg, RF, SVM, GradBoost, XGBoost, LightGBM,
    Extra Trees, KNN, MLP

Uses Leave-One-Subject-Out cross-validation on the WESAD dataset.
Exports the best model for integration with the CorSense web app.

Usage:
    source venv/bin/activate && python train_stress_model.py
"""

import pickle
import warnings
import json
from pathlib import Path
from itertools import product

import numpy as np
from scipy import signal as scipy_signal
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import (
    RandomForestClassifier, GradientBoostingClassifier, ExtraTreesClassifier
)
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
)
from sklearn.base import clone
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.feature_selection import mutual_info_classif
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier
import joblib

# --- Configuration ---
DATA_DIR = Path(__file__).parent / "data" / "WESAD"
OUTPUT_DIR = Path(__file__).parent / "models"
SUBJECTS = ["S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9",
            "S10", "S11", "S13", "S14", "S15", "S16", "S17"]

WINDOW_SIZES = [30, 60, 120]  # seconds — search over these
MIN_RR_IN_WINDOW = 10

STRESS_LABEL = 2
VALID_LABELS = [1, 2, 3]

FEATURE_NAMES = [
    # Time-domain
    'mean_rr', 'sdnn', 'rmssd', 'pnn50',
    'mean_hr', 'std_hr', 'range_rr', 'median_rr', 'cv_rr',
    # Non-linear (Poincare)
    'sd1', 'sd2', 'sd1_sd2_ratio',
    # Frequency-domain (Lomb-Scargle)
    'lf_power', 'hf_power', 'lf_hf_ratio', 'total_power',
    # Data quality
    'rr_count', 'rr_coverage',
]


# =============================================================================
# Data Loading
# =============================================================================

def load_ibi_data(subject_id: str):
    """Load IBI data from E4 CSV. Returns (timestamps, ibi_values) in seconds."""
    ibi_path = DATA_DIR / subject_id / f"{subject_id}_E4_Data" / "IBI.csv"
    timestamps, ibi_values = [], []

    with open(ibi_path, 'r') as f:
        f.readline()
        for line in f:
            parts = line.strip().split(',')
            if len(parts) == 2:
                t, ibi = float(parts[0]), float(parts[1])
                if 0.3 <= ibi <= 2.0:
                    timestamps.append(t)
                    ibi_values.append(ibi)

    return np.array(timestamps), np.array(ibi_values)


def load_labels_and_offset(subject_id: str):
    """Load labels from pickle and compute E4-to-RespiBAN time offset."""
    pkl_path = DATA_DIR / subject_id / f"{subject_id}.pkl"
    with open(pkl_path, 'rb') as f:
        data = pickle.load(f, encoding='latin1')

    labels = data['label']
    label_dur = len(labels) / 700.0
    wrist_bvp = data['signal']['wrist']['BVP']
    wrist_dur = len(wrist_bvp) / 64.0
    offset = label_dur - wrist_dur
    return labels, offset


def get_label_at_time(t_sec: float, labels: np.ndarray, offset: float) -> int:
    respiban_time = t_sec + offset
    idx = int(respiban_time * 700)
    if 0 <= idx < len(labels):
        return int(labels[idx])
    return 0


# =============================================================================
# HRV Feature Extraction
# =============================================================================

def compute_time_domain(rr_ms: np.ndarray) -> dict:
    diffs = np.diff(rr_ms)
    mean_rr = np.mean(rr_ms)
    sdnn = np.std(rr_ms, ddof=1) if len(rr_ms) > 1 else 0.0
    rmssd = np.sqrt(np.mean(diffs ** 2)) if len(diffs) > 0 else 0.0
    pnn50 = (np.sum(np.abs(diffs) > 50) / len(diffs) * 100) if len(diffs) > 0 else 0.0
    hr = 60000.0 / rr_ms

    return {
        'mean_rr': mean_rr,
        'sdnn': sdnn,
        'rmssd': rmssd,
        'pnn50': pnn50,
        'mean_hr': np.mean(hr),
        'std_hr': np.std(hr, ddof=1) if len(hr) > 1 else 0.0,
        'range_rr': np.ptp(rr_ms),
        'median_rr': np.median(rr_ms),
        'cv_rr': sdnn / mean_rr if mean_rr > 0 else 0.0,
    }


def compute_poincare(rr_ms: np.ndarray) -> dict:
    if len(rr_ms) < 2:
        return {'sd1': 0, 'sd2': 0, 'sd1_sd2_ratio': 0}
    diffs = np.diff(rr_ms)
    sums = rr_ms[:-1] + rr_ms[1:]
    sd1 = np.std(diffs, ddof=1) / np.sqrt(2)
    sd2 = np.std(sums, ddof=1) / np.sqrt(2)
    return {
        'sd1': sd1,
        'sd2': sd2,
        'sd1_sd2_ratio': sd1 / sd2 if sd2 > 0 else 0,
    }


def compute_frequency(timestamps_sec: np.ndarray, rr_ms: np.ndarray) -> dict:
    """Frequency-domain HRV via Lomb-Scargle (handles uneven RR spacing)."""
    if len(rr_ms) < 4:
        return {'lf_power': 0, 'hf_power': 0, 'lf_hf_ratio': 0, 'total_power': 0}

    rr_detrended = rr_ms - np.mean(rr_ms)
    freqs = np.arange(0.04, 0.4, 0.001)

    try:
        pgram = scipy_signal.lombscargle(
            timestamps_sec, rr_detrended, 2 * np.pi * freqs, normalize=False
        )
        lf_mask = (freqs >= 0.04) & (freqs < 0.15)
        hf_mask = (freqs >= 0.15) & (freqs <= 0.4)
        lf = np.trapezoid(pgram[lf_mask], freqs[lf_mask])
        hf = np.trapezoid(pgram[hf_mask], freqs[hf_mask])
        return {
            'lf_power': lf,
            'hf_power': hf,
            'lf_hf_ratio': lf / hf if hf > 0 else 0,
            'total_power': np.trapezoid(pgram, freqs),
        }
    except Exception:
        return {'lf_power': 0, 'hf_power': 0, 'lf_hf_ratio': 0, 'total_power': 0}


def extract_features(timestamps_sec: np.ndarray, rr_sec: np.ndarray,
                     window_duration: float) -> dict | None:
    if len(rr_sec) < MIN_RR_IN_WINDOW:
        return None

    rr_ms = rr_sec * 1000.0
    ts = timestamps_sec - timestamps_sec[0]

    features = {}
    features.update(compute_time_domain(rr_ms))
    features.update(compute_poincare(rr_ms))
    features.update(compute_frequency(ts, rr_ms))
    features['rr_count'] = len(rr_ms)
    features['rr_coverage'] = np.sum(rr_sec) / window_duration
    return features


# =============================================================================
# Dataset Construction
# =============================================================================

def build_subject_dataset(subject_id: str, window_size: int, window_stride: int):
    """Build feature matrix and labels for one subject using sliding windows."""
    timestamps, ibi_values = load_ibi_data(subject_id)
    if len(timestamps) < MIN_RR_IN_WINDOW:
        return None

    labels, offset = load_labels_and_offset(subject_id)
    ibi_labels = np.array([get_label_at_time(t, labels, offset) for t in timestamps])

    valid_mask = np.isin(ibi_labels, VALID_LABELS)
    if valid_mask.sum() < MIN_RR_IN_WINDOW:
        return None

    features_list, labels_list = [], []
    win_start = timestamps[0]
    total_time = timestamps[-1]

    while win_start + window_size <= total_time:
        win_end = win_start + window_size
        mask = (timestamps >= win_start) & (timestamps < win_end)
        win_ts = timestamps[mask]
        win_ibi = ibi_values[mask]
        win_lbl = ibi_labels[mask]

        valid_in_win = np.isin(win_lbl, VALID_LABELS)
        if valid_in_win.sum() >= MIN_RR_IN_WINDOW:
            feats = extract_features(
                win_ts[valid_in_win], win_ibi[valid_in_win], window_size
            )
            if feats is not None:
                majority = np.argmax(np.bincount(win_lbl[valid_in_win].astype(int)))
                binary_label = 1 if majority == STRESS_LABEL else 0
                features_list.append(feats)
                labels_list.append(binary_label)

        win_start += window_stride

    if not features_list:
        return None

    X = np.array([[f[name] for name in FEATURE_NAMES] for f in features_list])
    y = np.array(labels_list)
    return X, y


def build_full_dataset(window_size: int, window_stride: int):
    """Build dataset across all subjects. Returns (X, y, groups)."""
    all_X, all_y, all_groups = [], [], []

    for i, subj in enumerate(SUBJECTS):
        result = build_subject_dataset(subj, window_size, window_stride)
        if result is not None:
            X, y = result
            all_X.append(X)
            all_y.append(y)
            all_groups.append(np.full(len(y), i))

    X = np.vstack(all_X)
    y = np.concatenate(all_y)
    groups = np.concatenate(all_groups)

    # Remove NaN/Inf
    bad = np.any(np.isnan(X) | np.isinf(X), axis=1)
    if bad.sum() > 0:
        X, y, groups = X[~bad], y[~bad], groups[~bad]

    return X, y, groups


# =============================================================================
# Feature Selection
# =============================================================================

def select_features(X: np.ndarray, y: np.ndarray, feature_names: list,
                    min_importance: float = 0.01):
    """Select features using mutual information. Returns (mask, selected_names, scores)."""
    mi_scores = mutual_info_classif(X, y, random_state=42, n_neighbors=5)
    mi_scores = mi_scores / mi_scores.max()  # normalize to [0, 1]

    mask = mi_scores >= min_importance
    selected = [name for name, keep in zip(feature_names, mask) if keep]

    print(f"\n  Feature selection (mutual info, threshold={min_importance}):")
    ranked = sorted(zip(feature_names, mi_scores), key=lambda x: x[1], reverse=True)
    for name, score in ranked:
        marker = "*" if score >= min_importance else " "
        print(f"    {marker} {name:20s} {score:.3f}")
    print(f"  Selected: {sum(mask)}/{len(feature_names)} features\n")

    return mask, selected, dict(ranked)


# =============================================================================
# Model Training with Hyperparameter Search
# =============================================================================

def get_model_grid():
    """Return models and their hyperparameter grids."""
    n_pos = 1  # placeholder, updated at runtime
    n_neg = 1

    return {
        'Logistic Regression': {
            'base': LogisticRegression(max_iter=1000, class_weight='balanced', random_state=42),
            'params': {'C': [0.01, 0.1, 1.0, 10.0]},
        },
        'Random Forest': {
            'base': RandomForestClassifier(class_weight='balanced', random_state=42, n_jobs=-1),
            'params': {
                'n_estimators': [100, 300],
                'max_depth': [5, 10, 20],
            },
        },
        'Extra Trees': {
            'base': ExtraTreesClassifier(class_weight='balanced', random_state=42, n_jobs=-1),
            'params': {
                'n_estimators': [100, 300],
                'max_depth': [5, 10, 20],
            },
        },
        'SVM (RBF)': {
            'base': SVC(kernel='rbf', class_weight='balanced', probability=True, random_state=42),
            'params': {'C': [0.1, 1.0, 10.0], 'gamma': ['scale', 0.01, 0.001]},
        },
        'KNN': {
            'base': KNeighborsClassifier(),
            'params': {
                'n_neighbors': [3, 5, 9, 15],
                'weights': ['uniform', 'distance'],
            },
        },
        'MLP': {
            'base': MLPClassifier(max_iter=500, early_stopping=True, random_state=42),
            'params': {
                'hidden_layer_sizes': [(64,), (128, 64), (64, 32, 16)],
                'alpha': [0.001, 0.01],
            },
        },
        'Gradient Boosting': {
            'base': GradientBoostingClassifier(random_state=42),
            'params': {
                'n_estimators': [100, 300],
                'max_depth': [3, 6],
                'learning_rate': [0.05, 0.1],
            },
        },
        'XGBoost': {
            'base': XGBClassifier(
                random_state=42, eval_metric='logloss', verbosity=0,
            ),
            'params': {
                'n_estimators': [100, 300],
                'max_depth': [3, 6],
                'learning_rate': [0.05, 0.1],
            },
        },
        'LightGBM': {
            'base': LGBMClassifier(random_state=42, verbosity=-1),
            'params': {
                'n_estimators': [100, 300],
                'max_depth': [3, 6],
                'learning_rate': [0.05, 0.1],
            },
        },
    }


def _param_combos(param_grid: dict) -> list[dict]:
    """Generate all parameter combinations from a grid."""
    keys = list(param_grid.keys())
    values = list(param_grid.values())
    return [dict(zip(keys, combo)) for combo in product(*values)]


def loso_evaluate(model, X, y, groups):
    """Run LOSO CV for a single model. Returns metrics dict with AUC."""
    logo = LeaveOneGroupOut()
    all_true, all_pred, all_proba = [], [], []
    per_subject = []

    for train_idx, test_idx in logo.split(X, y, groups):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        scaler = StandardScaler()
        X_tr = scaler.fit_transform(X_train)
        X_te = scaler.transform(X_test)

        m = clone(model)
        m.fit(X_tr, y_train)
        y_pred = m.predict(X_te)

        # Get probabilities for AUC
        if hasattr(m, 'predict_proba'):
            y_prob = m.predict_proba(X_te)[:, 1]
        elif hasattr(m, 'decision_function'):
            y_prob = m.decision_function(X_te)
        else:
            y_prob = y_pred.astype(float)

        all_true.extend(y_test)
        all_pred.extend(y_pred)
        all_proba.extend(y_prob)

        subj_id = SUBJECTS[int(groups[test_idx][0])]
        per_subject.append({
            'subject': subj_id,
            'accuracy': accuracy_score(y_test, y_pred),
            'f1': f1_score(y_test, y_pred, zero_division=0),
            'n_samples': len(y_test),
            'n_stress': int(np.sum(y_test == 1)),
        })

    all_true, all_pred, all_proba = np.array(all_true), np.array(all_pred), np.array(all_proba)

    try:
        auc = roc_auc_score(all_true, all_proba)
    except ValueError:
        auc = 0.0

    return {
        'accuracy': accuracy_score(all_true, all_pred),
        'f1': f1_score(all_true, all_pred, zero_division=0),
        'precision': precision_score(all_true, all_pred, zero_division=0),
        'recall': recall_score(all_true, all_pred, zero_division=0),
        'auc': auc,
        'per_subject': per_subject,
    }


def loso_collect_probas(model, X, y, groups):
    """Run LOSO CV and collect all predicted probabilities for threshold tuning."""
    logo = LeaveOneGroupOut()
    all_true, all_proba = [], []

    for train_idx, test_idx in logo.split(X, y, groups):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y[train_idx], y[test_idx]

        scaler = StandardScaler()
        X_tr = scaler.fit_transform(X_train)
        X_te = scaler.transform(X_test)

        m = clone(model)
        m.fit(X_tr, y_train)

        if hasattr(m, 'predict_proba'):
            y_prob = m.predict_proba(X_te)[:, 1]
        elif hasattr(m, 'decision_function'):
            y_prob = m.decision_function(X_te)
        else:
            y_prob = m.predict(X_te).astype(float)

        all_true.extend(y_test)
        all_proba.extend(y_prob)

    return np.array(all_true), np.array(all_proba)


def optimize_threshold(y_true, y_proba):
    """Find the threshold that maximizes F1 score."""
    best_f1, best_thresh = 0, 0.5
    for thresh in np.arange(0.20, 0.80, 0.01):
        y_pred = (y_proba >= thresh).astype(int)
        f1 = f1_score(y_true, y_pred, zero_division=0)
        if f1 > best_f1:
            best_f1 = f1
            best_thresh = thresh
    return best_thresh, best_f1


def metrics_at_threshold(y_true, y_proba, threshold):
    """Compute all metrics at a given threshold."""
    y_pred = (y_proba >= threshold).astype(int)
    try:
        auc = roc_auc_score(y_true, y_proba)
    except ValueError:
        auc = 0.0
    return {
        'accuracy': accuracy_score(y_true, y_pred),
        'f1': f1_score(y_true, y_pred, zero_division=0),
        'precision': precision_score(y_true, y_pred, zero_division=0),
        'recall': recall_score(y_true, y_pred, zero_division=0),
        'auc': auc,
        'threshold': threshold,
    }


def train_and_evaluate(X: np.ndarray, y: np.ndarray, groups: np.ndarray,
                       feature_names: list):
    """Train models with hyperparameter search + LOSO CV + threshold optimization."""
    print("=== Training Models (LOSO CV + Hyperparam Search + Threshold Opt) ===\n")

    model_grid = get_model_grid()
    all_results = {}
    best_overall_f1 = -1
    best_overall_name = None
    best_overall_params = None
    best_overall_threshold = 0.5

    for name, config in model_grid.items():
        combos = _param_combos(config['params'])
        print(f"  {name} ({len(combos)} configs)...", end=" ", flush=True)

        best_f1 = -1
        best_metrics = None
        best_params = None
        best_thresh = 0.5

        for params in combos:
            model = clone(config['base']).set_params(**params)

            # First: standard LOSO evaluation
            metrics = loso_evaluate(model, X, y, groups)

            # Then: collect probas for threshold optimization
            y_true, y_proba = loso_collect_probas(model, X, y, groups)
            opt_thresh, opt_f1 = optimize_threshold(y_true, y_proba)

            # Use whichever is better: default threshold or optimized
            if opt_f1 > metrics['f1']:
                tuned = metrics_at_threshold(y_true, y_proba, opt_thresh)
                tuned['per_subject'] = metrics['per_subject']  # keep per-subject from default
                effective_f1 = opt_f1
                effective_metrics = tuned
                effective_thresh = opt_thresh
            else:
                effective_f1 = metrics['f1']
                effective_metrics = metrics
                effective_thresh = 0.5

            if effective_f1 > best_f1:
                best_f1 = effective_f1
                best_metrics = effective_metrics
                best_params = params
                best_thresh = effective_thresh

        all_results[name] = {**best_metrics, 'best_params': best_params, 'threshold': best_thresh}

        thresh_note = f" (threshold={best_thresh:.2f})" if best_thresh != 0.5 else ""
        print(f"Acc={best_metrics['accuracy']:.3f}  F1={best_metrics['f1']:.3f}  "
              f"AUC={best_metrics['auc']:.3f}  "
              f"Prec={best_metrics['precision']:.3f}  Rec={best_metrics['recall']:.3f}"
              f"{thresh_note}")

        if best_f1 > best_overall_f1:
            best_overall_f1 = best_f1
            best_overall_name = name
            best_overall_params = best_params
            best_overall_threshold = best_thresh

    print(f"\n  Best: {best_overall_name} "
          f"(F1={best_overall_f1:.3f}, AUC={all_results[best_overall_name]['auc']:.3f}, "
          f"threshold={best_overall_threshold:.2f})\n")

    # Retrain best on all data
    base_model = model_grid[best_overall_name]['base']
    final_model = clone(base_model).set_params(**best_overall_params)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    final_model.fit(X_scaled, y)

    return (all_results, final_model, scaler, best_overall_name,
            best_overall_params, best_overall_threshold)


# =============================================================================
# Export
# =============================================================================

def export_model(model, scaler, model_name, best_params, threshold, results,
                 feature_names, window_size, window_stride):
    """Export model, scaler, and config to models/ directory."""
    OUTPUT_DIR.mkdir(exist_ok=True)

    model_path = OUTPUT_DIR / "stress_model.joblib"
    scaler_path = OUTPUT_DIR / "stress_scaler.joblib"
    config_path = OUTPUT_DIR / "stress_config.json"

    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)

    importances = None
    if hasattr(model, 'feature_importances_'):
        importances = dict(zip(feature_names, model.feature_importances_.tolist()))
    elif hasattr(model, 'coef_'):
        importances = dict(zip(feature_names, np.abs(model.coef_[0]).tolist()))

    config = {
        'model_name': model_name,
        'best_params': {k: str(v) for k, v in best_params.items()},
        'threshold': threshold,
        'feature_names': feature_names,
        'window_size_sec': window_size,
        'window_stride_sec': window_stride,
        'min_rr_in_window': MIN_RR_IN_WINDOW,
        'classes': {'0': 'non_stress', '1': 'stress'},
        'metrics': {
            name: {k: round(v, 4) for k, v in m.items()
                   if k not in ('per_subject', 'best_params', 'threshold')}
            for name, m in results.items()
        },
        'feature_importances': importances,
        'scaler_mean': scaler.mean_.tolist(),
        'scaler_scale': scaler.scale_.tolist(),
    }

    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)

    print("=== Exported ===")
    print(f"  {model_path}")
    print(f"  {scaler_path}")
    print(f"  {config_path}")
    if threshold != 0.5:
        print(f"  Optimized threshold: {threshold:.2f}")

    if importances:
        print("\n=== Top Features ===")
        sorted_feats = sorted(importances.items(), key=lambda x: x[1], reverse=True)
        for i, (feat, imp) in enumerate(sorted_feats[:10]):
            print(f"  {i+1:2d}. {feat:20s} {imp:.4f}")


# =============================================================================
# Main
# =============================================================================

def main():
    warnings.filterwarnings('ignore')

    print("WESAD Stress Detection Pipeline v3")
    print("=" * 55)
    print(f"Window sizes to search: {WINDOW_SIZES}s")
    print(f"Min RR/window: {MIN_RR_IN_WINDOW}")
    print(f"Subjects: {len(SUBJECTS)}")
    print(f"Models: 9 types with hyperparameter search")
    print(f"Task: stress vs non-stress (binary)\n")

    # --- Step 1: Find best window size ---
    print("=== Step 1: Window Size Search ===\n")
    best_window = None
    best_window_f1 = -1
    window_datasets = {}

    for win_size in WINDOW_SIZES:
        stride = win_size // 2
        print(f"  Window={win_size}s, Stride={stride}s ...", end=" ", flush=True)
        X, y, groups = build_full_dataset(win_size, stride)
        window_datasets[win_size] = (X, y, groups)

        svm = SVC(kernel='rbf', class_weight='balanced', C=1.0,
                  gamma='scale', probability=True, random_state=42)
        metrics = loso_evaluate(svm, X, y, groups)
        print(f"  {X.shape[0]} windows | F1={metrics['f1']:.3f} AUC={metrics['auc']:.3f}")

        if metrics['f1'] > best_window_f1:
            best_window_f1 = metrics['f1']
            best_window = win_size

    print(f"\n  Best window: {best_window}s (F1={best_window_f1:.3f})\n")

    X, y, groups = window_datasets[best_window]
    best_stride = best_window // 2

    print(f"  Dataset: {X.shape[0]} windows, {X.shape[1]} features")
    print(f"  Stress: {np.sum(y==1)}, Non-stress: {np.sum(y==0)} "
          f"({np.sum(y==1)/len(y)*100:.1f}% stress)\n")

    # --- Step 2: Feature selection ---
    print("=== Step 2: Feature Selection ===")
    feat_mask, selected_features, mi_scores = select_features(X, y, FEATURE_NAMES)
    X_sel = X[:, feat_mask]

    # --- Step 3: Train all models on selected features ---
    print("=== Step 3: Train on Selected Features ===\n")
    (results_sel, model_sel, scaler_sel, name_sel,
     params_sel, thresh_sel) = train_and_evaluate(X_sel, y, groups, selected_features)

    # --- Step 4: Train all models on full features ---
    print("=== Step 4: Train on Full Features ===\n")
    (results_full, model_full, scaler_full, name_full,
     params_full, thresh_full) = train_and_evaluate(X, y, groups, FEATURE_NAMES)

    # --- Step 5: Pick the best overall ---
    sel_f1 = results_sel[name_sel]['f1']
    full_f1 = results_full[name_full]['f1']

    print("=== Final Comparison ===\n")
    print(f"  Selected features ({len(selected_features)}): "
          f"{name_sel} F1={sel_f1:.3f} AUC={results_sel[name_sel]['auc']:.3f}")
    print(f"  Full features ({len(FEATURE_NAMES)}):     "
          f"{name_full} F1={full_f1:.3f} AUC={results_full[name_full]['auc']:.3f}\n")

    if full_f1 >= sel_f1:
        print(f"  -> Using full features with {name_full}\n")
        export_model(model_full, scaler_full, name_full, params_full, thresh_full,
                     results_full, FEATURE_NAMES, best_window, best_stride)
    else:
        print(f"  -> Using selected features with {name_sel}\n")
        export_model(model_sel, scaler_sel, name_sel, params_sel, thresh_sel,
                     results_sel, selected_features, best_window, best_stride)

    # --- Summary table ---
    print("\n=== All Models Summary ===\n")
    print(f"  {'Model':<25s} {'F1':>6s} {'AUC':>6s} {'Acc':>6s} {'Prec':>6s} {'Rec':>6s} {'Thr':>5s}")
    print(f"  {'-'*25} {'-'*6} {'-'*6} {'-'*6} {'-'*6} {'-'*6} {'-'*5}")

    # Merge both result sets, marking which feature set
    for tag, res in [("(sel)", results_sel), ("(full)", results_full)]:
        ranked = sorted(res.items(), key=lambda x: x[1]['f1'], reverse=True)
        for name, m in ranked:
            t = m.get('threshold', 0.5)
            t_str = f"{t:.2f}" if t != 0.5 else "  -  "
            print(f"  {name+' '+tag:<25s} {m['f1']:>6.3f} {m['auc']:>6.3f} "
                  f"{m['accuracy']:>6.3f} {m['precision']:>6.3f} {m['recall']:>6.3f} {t_str}")

    print("\nDone!")


if __name__ == "__main__":
    main()
