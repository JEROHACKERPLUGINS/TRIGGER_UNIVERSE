// clang++ -std=c++17 -O2 -I.. classifier_test.cpp -o /tmp/classifier_test && /tmp/classifier_test
// The classifier learns from the files whose NAME says the type and labels the rest.
// Synthetic library with continuous variation; 40 % of the files are "named".
// Checks: on the unnamed files the result is at least as good as the rules alone,
// named files keep their name's type, and with no named files it falls back to rules.
#include "DSP/SampleClassifier.h"
#include "DSP/SampleMap.h"
#include "drum_synth.h"
#include <cassert>
#include <cstdio>

using namespace tu;

int main()
{
  const int per = 60;
  std::vector<std::vector<float>> feat; std::vector<double> dur; std::vector<int> truth, rule, name;
  for (int k = 0; k < per; k++)
    for (int c = 0; c < kNumClasses; c++)
    {
      const auto f = AnalyzeSample({Vary(SynthDrum(c, (unsigned) (k + 300)), (unsigned) (k * 16 + c + 7))}, 48000.);
      std::vector<float> v(kFeatSize);
      std::copy(f.fp, f.fp + kFpSize, v.begin()); std::copy(f.desc, f.desc + kDescSize, v.begin() + kFpSize);
      feat.push_back(v); dur.push_back(f.durMs); truth.push_back(c); rule.push_back(f.cls);
      name.push_back(k % 5 < 2 ? c : -1); // 40 % named
    }
  const int n = (int) feat.size();
  std::vector<MapItem> items;
  for (int i = 0; i < n; i++) { MapItem m; m.feat = feat[(size_t) i].data(); m.durMs = dur[(size_t) i]; m.cls = 0; items.push_back(m); }
  MapParams P; P.wType = 0.; // the model must not see the type it has to predict
  auto X = MapFeatureRows(items, P);
  for (auto& r : X) r.resize(r.size() - kNumClasses); // drop the (zero) one-hot block

  const auto R = ClassifyLibrary(X, name, rule);
  int un = 0, okRule = 0, okFinal = 0, fromModel = 0, namedOk = 0, named = 0;
  for (int i = 0; i < n; i++)
  {
    if (name[(size_t) i] >= 0) { named++; namedOk += R.cls[(size_t) i] == name[(size_t) i]; continue; }
    un++; okRule += rule[(size_t) i] == truth[(size_t) i]; okFinal += R.cls[(size_t) i] == truth[(size_t) i];
    fromModel += R.source[(size_t) i] == 'm';
  }
  printf("trained %d, %d classes on %d named files\n", R.trained, R.learnedClasses, R.trainingFiles);
  printf("unnamed files: rules alone %.0f %%  ->  rules + model %.0f %%  (%d of %d decided by the model)\n",
         100. * okRule / un, 100. * okFinal / un, fromModel, un);
  printf("named files keep their type: %d / %d\n", namedOk, named);
  assert(R.trained && okFinal >= okRule && namedOk == named);

  // no named files -> exactly the rules
  const auto R0 = ClassifyLibrary(X, std::vector<int>((size_t) n, -1), rule);
  assert(!R0.trained);
  for (int i = 0; i < n; i++) assert(R0.cls[(size_t) i] == rule[(size_t) i]);
  printf("classifier_test OK\n");
  return 0;
}
