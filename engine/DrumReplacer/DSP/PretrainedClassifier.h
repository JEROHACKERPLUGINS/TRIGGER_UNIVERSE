#pragma once

// TRIGGER UNIVERSE · pre-trained drum-type classifier.
//
// Gradient-boosted decision trees (softmax over the types) trained offline in ml/ on a large
// library whose file and folder names say the type (ml/names.py groups the names,
// ml/train.py trains and writes DSP/PretrainedWeights.h). It sees the same feature
// row as the library model (RawFeatureRow: cepstrum of the fingerprint, log length,
// descriptors), computed by the plugin's own AnalyzeSample, so training and runtime
// numbers are identical.
//
// It replaces the hand-written rules when it is sure (prob >= kSure, chosen on
// held-out packs); below that the rules decide. The name of the file and the
// per-library model (SampleClassifier.h) still come on top, as before.

#include "SampleMap.h"
#include "PretrainedWeights.h"
#include <cmath>

namespace tu
{

// Feature row (RawFeatureRow) -> type. Returns false when there is no model (or it
// was trained on other features); otherwise cls / prob are the best type and its probability.
inline bool PretrainedPredictRow(const double* x, int& cls, double& prob)
{
  using namespace pretrained;
  if (!kReady || kTrainedAnalysisVersion != kAnalysisVersion || kNumFeatures != kRawFeatSize) return false;
  float xf[kRawFeatSize];
  for (int d = 0; d < kRawFeatSize; d++) xf[d] = (float) x[d];
  double z[kOut > 0 ? kOut : 1];
  for (int k = 0; k < kOut; k++) z[k] = kBase[k];
  for (int t = 0; t < kNumTrees; t++)
  {
    const Node* n = kNodes + kRoot[t];
    while (n->feat >= 0) n = xf[n->feat] <= n->thr ? n + 1 : kNodes + n->right;
    z[kTreeClass[t]] += n->thr;
  }
  int best = 0;
  for (int k = 1; k < kOut; k++) if (z[k] > z[best]) best = k;
  double s = 0.;
  for (int k = 0; k < kOut; k++) s += std::exp(z[k] - z[best]);
  cls = kClassOf[best];
  prob = 1. / s;
  return true;
}

// Same, from a stored fingerprint + descriptors (kFeatSize floats).
inline bool PretrainedPredict(const float* feat, double durMs, int& cls, double& prob)
{
  using namespace pretrained;
  if (!kReady || kTrainedAnalysisVersion != kAnalysisVersion || kNumFeatures != kRawFeatSize) return false;
  double x[kRawFeatSize];
  RawFeatureRow(feat, durMs, x);
  return PretrainedPredictRow(x, cls, prob);
}

// Type to use instead of the rules' guess: the model's when it is sure, else ruleCls.
inline int PretrainedOrRules(const float* feat, double durMs, int ruleCls, double* probOut = nullptr)
{
  int cls; double prob;
  if (PretrainedPredict(feat, durMs, cls, prob) && prob >= pretrained::kSure)
  {
    if (probOut) *probOut = prob;
    return cls;
  }
  return ruleCls;
}

// The model's type when it is sure, else -1 (rules decide). Pure function of the
// fingerprint: the plugin stores it per file with pretrained::kModelId and only
// recomputes it when the model changes.
inline int PretrainedSureClass(const float* feat, double durMs)
{
  int cls; double prob;
  return PretrainedPredict(feat, durMs, cls, prob) && prob >= pretrained::kSure ? cls : -1;
}

} // namespace tu
