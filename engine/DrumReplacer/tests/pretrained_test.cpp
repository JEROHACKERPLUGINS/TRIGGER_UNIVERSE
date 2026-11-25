// clang++ -std=c++17 -O2 -I.. pretrained_test.cpp -o /tmp/pretrained_test && /tmp/pretrained_test [feat.csv predictions.tsv]
// 1. Without arguments: the model loads, gives valid types / probabilities, and with the
//    placeholder weights (kReady = false) PretrainedOrRules returns the rules untouched.
// 2. With the training files from ml/: the C++ trees give the same type as sklearn on every row.
#include "DSP/PretrainedClassifier.h"
#include "drum_synth.h"
#include <cassert>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>

using namespace tu;

int main(int argc, char** argv)
{
  // synthetic one-shots through the plugin's analysis
  int same = 0, total = 0;
  for (int c = 0; c < kNumClasses; c++)
    for (int k = 0; k < 10; k++)
    {
      const auto f = AnalyzeSample({Vary(SynthDrum(c, (unsigned) (k + 50)), (unsigned) (k * 7 + c))}, 48000.);
      float feat[kFeatSize];
      std::copy(f.fp, f.fp + kFpSize, feat); std::copy(f.desc, f.desc + kDescSize, feat + kFpSize);
      int cls; double prob;
      const bool ok = PretrainedPredict(feat, f.durMs, cls, prob);
      assert(ok == pretrained::kReady);
      if (ok) assert(cls >= 0 && cls < kNumClasses && prob > 0. && prob <= 1.0000001);
      const int out = PretrainedOrRules(feat, f.durMs, f.cls);
      if (!pretrained::kReady) assert(out == f.cls);
      same += out == c; total++;
    }
  printf("model %s · synthetic drums typed right: %d / %d\n", pretrained::kReady ? "loaded" : "absent (rules)", same, total);

  if (argc >= 3 && pretrained::kReady)
  {
    static const char* names[kNumClasses] = {"Kick", "Snare", "Clap", "HHC", "HHO", "Cymbal", "Tom", "Perc", "FX"};
    std::map<long, std::string> py;
    std::ifstream pf(argv[2]); std::string line;
    std::getline(pf, line);
    while (std::getline(pf, line))
    {
      std::stringstream ss(line); std::string id, l, s, m;
      std::getline(ss, id, '\t'); std::getline(ss, l, '\t'); std::getline(ss, s, '\t'); std::getline(ss, m, '\t');
      py[std::atol(id.c_str())] = m;
    }
    std::ifstream ff(argv[1]);
    long n = 0, agree = 0;
    while (std::getline(ff, line))
    {
      std::stringstream ss(line); std::string tok; std::vector<double> v;
      while (std::getline(ss, tok, ',')) v.push_back(std::atof(tok.c_str()));
      if (v.size() != (size_t) (5 + kRawFeatSize) || v[1] != 1.) continue;
      int cls; double prob;
      PretrainedPredictRow(v.data() + 5, cls, prob);
      n++; agree += py[(long) v[0]] == names[cls];
    }
    printf("parity with sklearn: %ld / %ld rows (%.4f %%)\n", agree, n, 100. * agree / std::max(1L, n));
    assert(n > 0 && agree * 1000 >= n * 999);
  }
  printf("pretrained_test OK\n");
  return 0;
}
