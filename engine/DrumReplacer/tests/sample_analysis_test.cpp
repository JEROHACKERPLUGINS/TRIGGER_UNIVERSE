// clang++ -std=c++17 -O2 -I.. sample_analysis_test.cpp -o /tmp/sa_test && /tmp/sa_test [wav files...]
// 1) Classifies 12 synthetic variations of each drum type and prints the confusion matrix.
// 2) Prints the analysis of any WAV passed on the command line (real samples).
#include "DSP/SampleAnalysis.h"
#include "DSP/WavFile.h"
#include "drum_synth.h"
#include <cassert>
#include <cstdio>

int main(int argc, char** argv)
{
  using namespace tu;
  const int per = 12;
  int conf[kNumClasses][kNumClasses] = {};
  int correct = 0, total = 0;
  for (int c = 0; c < kNumClasses; c++)
    for (int k = 0; k < per; k++)
    {
      const auto y = SynthDrum(c, (unsigned) k);
      const auto f = AnalyzeSample({y}, 48000.);
      assert(f.ok);
      conf[c][f.cls]++;
      correct += f.cls == c; total++;
      if (argc > 1 && std::string(argv[1]) == "-v")
        printf("%-6s #%2d -> %-6s conf %.2f | bands %.2f %.2f %.2f %.2f %.2f %.2f bright %6.1f air %6.1f nflat %.2f d40 %5.0f att %d\n",
               DrumClassName(c), k, DrumClassName(f.cls), f.conf, f.band[0], f.band[1], f.band[2], f.band[3], f.band[4], f.band[5],
               f.brightDb, f.airDb, f.noiseFlat, f.decay40, f.attacks);
    }
  printf("synthetic: %d / %d correct (%.0f%%)\n        ", correct, total, 100. * correct / total);
  for (int c = 0; c < kNumClasses; c++) printf("%7s", DrumClassName(c));
  printf("\n");
  for (int c = 0; c < kNumClasses; c++)
  {
    printf("%-7s ", DrumClassName(c));
    for (int d = 0; d < kNumClasses; d++) printf("%7d", conf[c][d]);
    printf("\n");
  }

  for (int i = 1; i < argc; i++)
  {
    if (std::string(argv[i]) == "-v") continue;
    std::vector<std::vector<float>> ch; double sr = 0;
    if (!LoadWavFile(argv[i], ch, sr)) { printf("can't read %s\n", argv[i]); continue; }
    const auto f = AnalyzeSample(ch, sr);
    const char* base = strrchr(argv[i], '/'); base = base ? base + 1 : argv[i];
    printf("%-34.34s -> %-6s conf %.2f | bands %.2f %.2f %.2f %.2f %.2f %.2f bright %6.1f air %6.1f nflat %.2f d40 %5.0f att %d dur %.0f\n",
           base, DrumClassName(f.cls), f.conf, f.band[0], f.band[1], f.band[2], f.band[3], f.band[4], f.band[5],
           f.brightDb, f.airDb, f.noiseFlat, f.decay40, f.attacks, f.durMs);
  }
  return correct * 100 >= total * 85 ? 0 : 1;
}
