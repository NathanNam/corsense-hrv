"""Export LightGBM model trees to JSON for browser-based inference."""

import json
import joblib
from pathlib import Path

MODEL_DIR = Path(__file__).parent / "models"
WEB_DIR = Path(__file__).parent / "web" / "lib"


def parse_tree(tree_info: dict) -> dict:
    """Recursively parse a LightGBM tree into a compact JSON structure."""
    node = tree_info

    if "leaf_value" in node:
        return {"v": node["leaf_value"]}

    return {
        "f": node["split_feature"],      # feature name
        "t": node["threshold"],           # split threshold
        "d": node.get("decision_type", "<="),
        "l": parse_tree(node["left_child"]),
        "r": parse_tree(node["right_child"]),
    }


def main():
    model = joblib.load(MODEL_DIR / "stress_model.joblib")
    config = json.loads((MODEL_DIR / "stress_config.json").read_text())

    # Dump the booster model
    model_dump = model.booster_.dump_model()

    trees = []
    for tree_info in model_dump["tree_info"]:
        trees.append(parse_tree(tree_info["tree_structure"]))

    output = {
        "trees": trees,
        "feature_names": config["feature_names"],
        "scaler_mean": config["scaler_mean"],
        "scaler_scale": config["scaler_scale"],
        "threshold": config["threshold"],
        "window_size_sec": config["window_size_sec"],
        "min_rr_in_window": config["min_rr_in_window"],
        "objective": model_dump.get("objective", "binary cross_entropy"),
    }

    out_path = WEB_DIR / "stress-model-data.json"
    out_path.write_text(json.dumps(output, indent=2))
    print(f"Exported {len(trees)} trees to {out_path}")
    print(f"Features: {config['feature_names']}")
    print(f"Threshold: {config['threshold']}")


if __name__ == "__main__":
    main()
