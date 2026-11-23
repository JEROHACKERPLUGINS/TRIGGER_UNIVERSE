#pragma once

// TRIGGER UNIVERSE · drum-type classifier that learns from the user's library.
//
// Many sample packs say what a file is in its name ("Kick 03", "HH closed").
// Those files are the training set: a softmax (multinomial logistic) regression
// over the same feature rows the map uses (cepstrum of the fingerprint, length,
// descriptors incl. LUFS / druminess / late transient), trained on the library
// analysis thread (full batch, Adam, L2). It then labels the files whose name
// says nothing. Our own model, trained only on the user's own files.
//
// Final type of a file:
//   1. its name says it            -> that (the user's naming wins)
//   2. the model is sure (>= 0.55)  -> the model
//   3. otherwise                    -> the rule-based classifier (SampleAnalysis.h)
// Classes with fewer than kMinPerClass named files are not learned (rules cover them).

#include "SampleAnalysis.h"
#include <algorithm>
#include <cmath>
#include <vector>

namespace tu
{

constexpr int kMinPerClass = 6;
constexpr double kModelSure = 0.55;

struct ClassifierResult
{
  bool trained = false;
  int learnedClasses = 0;
  int trainingFiles = 0;
  std::vector<int> cls;     // final type per file
  std::vector<double> prob; // model probability of that type (0 when it came from the name / rules)
  std::vector<char> source; // 'n' name, 'm' model, 'r' rules
};

// X: one feature row per file (already scaled); nameCls: type from the file name or -1;
// ruleCls: type from the rule-based classifier.
inline ClassifierResult ClassifyLibrary(const std::vector<std::vector<double>>& X, const std::vector<int>& nameCls,
                                        const std::vector<int>& ruleCls, int iters = 400)
{
  const int n = (int) X.size();
  ClassifierResult R;
  R.cls.assign((size_t) n, kClsPerc); R.prob.assign((size_t) n, 0.); R.source.assign((size_t) n, 'r');
  if (n == 0) return R;
  const int D = (int) X[0].size();

  // which classes have enough named files
  int count[kNumClasses] = {};
  for (int i = 0; i < n; i++) if (nameCls[(size_t) i] >= 0) count[nameCls[(size_t) i]]++;
  std::vector<int> cls2idx(kNumClasses, -1), idx2cls;
  for (int c = 0; c < kNumClasses; c++) if (count[c] >= kMinPerClass) { cls2idx[c] = (int) idx2cls.size(); idx2cls.push_back(c); }
  const int C = (int) idx2cls.size();

  std::vector<int> train;
  for (int i = 0; i < n; i++) if (nameCls[(size_t) i] >= 0 && cls2idx[nameCls[(size_t) i]] >= 0) train.push_back(i);

  std::vector<double> W, b;
  if (C >= 2 && (int) train.size() >= 2 * kMinPerClass)
  {
    R.trained = true; R.learnedClasses = C; R.trainingFiles = (int) train.size();
    W.assign((size_t) C * D, 0.); b.assign((size_t) C, 0.);
    std::vector<double> mW(W.size(), 0.), vW(W.size(), 0.), mb(b.size(), 0.), vb(b.size(), 0.);
    std::vector<double> gW(W.size()), gb(b.size()), p((size_t) C);
    // balance classes: each class weighs the same in the loss
    std::vector<double> cw((size_t) C);
    for (int k = 0; k < C; k++) cw[(size_t) k] = (double) train.size() / (C * (double) count[idx2cls[(size_t) k]]);
    const double lr = 0.05, l2 = 1e-3, b1 = .9, b2 = .999, eps = 1e-8;
    for (int it = 1; it <= iters; it++)
    {
      std::fill(gW.begin(), gW.end(), 0.); std::fill(gb.begin(), gb.end(), 0.);
      for (int i : train)
      {
        const auto& x = X[(size_t) i];
        double mx = -1e300;
        for (int k = 0; k < C; k++)
        {
          double z = b[(size_t) k];
          for (int d = 0; d < D; d++) z += W[(size_t) k * D + d] * x[(size_t) d];
          p[(size_t) k] = z; mx = std::max(mx, z);
        }
        double s = 0; for (auto& v : p) { v = std::exp(v - mx); s += v; }
        const int y = cls2idx[nameCls[(size_t) i]];
        const double w = cw[(size_t) y];
        for (int k = 0; k < C; k++)
        {
          const double g = w * (p[(size_t) k] / s - (k == y ? 1. : 0.));
          gb[(size_t) k] += g;
          for (int d = 0; d < D; d++) gW[(size_t) k * D + d] += g * x[(size_t) d];
        }
      }
      const double inv = 1. / train.size();
      auto adam = [&](std::vector<double>& P, std::vector<double>& G, std::vector<double>& M, std::vector<double>& V, bool reg) {
        for (size_t q = 0; q < P.size(); q++)
        {
          const double g = G[q] * inv + (reg ? l2 * P[q] : 0.);
          M[q] = b1 * M[q] + (1 - b1) * g; V[q] = b2 * V[q] + (1 - b2) * g * g;
          const double mh = M[q] / (1 - std::pow(b1, it)), vh = V[q] / (1 - std::pow(b2, it));
          P[q] -= lr * mh / (std::sqrt(vh) + eps);
        }
      };
      adam(W, gW, mW, vW, true); adam(b, gb, mb, vb, false);
    }
  }

  std::vector<double> p((size_t) std::max(C, 1));
  for (int i = 0; i < n; i++)
  {
    if (nameCls[(size_t) i] >= 0) { R.cls[(size_t) i] = nameCls[(size_t) i]; R.source[(size_t) i] = 'n'; continue; }
    R.cls[(size_t) i] = ruleCls[(size_t) i];
    if (!R.trained) continue;
    const auto& x = X[(size_t) i];
    double mx = -1e300;
    for (int k = 0; k < C; k++)
    {
      double z = b[(size_t) k];
      for (int d = 0; d < D; d++) z += W[(size_t) k * D + d] * x[(size_t) d];
      p[(size_t) k] = z; mx = std::max(mx, z);
    }
    double s = 0; int best = 0;
    for (int k = 0; k < C; k++) { p[(size_t) k] = std::exp(p[(size_t) k] - mx); s += p[(size_t) k]; if (p[(size_t) k] > p[(size_t) best]) best = k; }
    const double pb = p[(size_t) best] / s;
    if (pb >= kModelSure) { R.cls[(size_t) i] = idx2cls[(size_t) best]; R.prob[(size_t) i] = pb; R.source[(size_t) i] = 'm'; }
  }
  return R;
}

} // namespace tu
