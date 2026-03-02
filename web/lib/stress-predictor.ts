/**
 * LightGBM inference in the browser.
 * Loads the exported tree structure and runs prediction on scaled features.
 */

import modelData from './stress-model-data.json';

interface LeafNode {
  v: number;
}

interface SplitNode {
  f: number;   // feature index
  t: number;   // threshold
  d: string;   // decision type (<=)
  l: TreeNode; // left child
  r: TreeNode; // right child
}

type TreeNode = LeafNode | SplitNode;

function isLeaf(node: TreeNode): node is LeafNode {
  return 'v' in node;
}

function traverseTree(node: TreeNode, features: number[]): number {
  if (isLeaf(node)) {
    return node.v;
  }

  const value = features[node.f];
  // LightGBM default: go left if value <= threshold
  if (value <= node.t) {
    return traverseTree(node.l, features);
  } else {
    return traverseTree(node.r, features);
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Scale features using the saved StandardScaler parameters.
 * scaled = (x - mean) / scale
 */
function scaleFeatures(features: number[]): number[] {
  const { scaler_mean, scaler_scale } = modelData;
  return features.map((val, i) => (val - scaler_mean[i]) / scaler_scale[i]);
}

export interface StressPrediction {
  probability: number;  // 0-1, probability of stress
  isStress: boolean;    // true if probability >= threshold
  label: 'stress' | 'non_stress';
}

/**
 * Predict stress from a raw (unscaled) feature vector.
 * Features must be in FEATURE_NAMES order (18 features).
 */
export function predictStress(rawFeatures: number[]): StressPrediction {
  const scaled = scaleFeatures(rawFeatures);

  // Sum leaf values across all trees
  let rawScore = 0;
  for (const tree of modelData.trees as TreeNode[]) {
    rawScore += traverseTree(tree, scaled);
  }

  const probability = sigmoid(rawScore);
  const isStress = probability >= modelData.threshold;

  return {
    probability,
    isStress,
    label: isStress ? 'stress' : 'non_stress',
  };
}

export const MODEL_CONFIG = {
  windowSizeSec: modelData.window_size_sec,
  minRrInWindow: modelData.min_rr_in_window,
  threshold: modelData.threshold,
  featureCount: modelData.feature_names.length,
};
