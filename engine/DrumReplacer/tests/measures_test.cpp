// clang++ -std=c++17 -O2 -I.. measures_test.cpp -o /tmp/measures_test && /tmp/measures_test
// LUFS (ITU-R BS.1770 reference: a 997 Hz sine at 0 dBFS in one channel = -3.01 LUFS),
// druminess and late transient on cases with a known answer.
#include "DSP/SampleAnalysis.h"
#include "drum_synth.h"
#include <cassert>
#include <cstdio>

using namespace tu;

static std::vector<float> Sine(double hz, double dbfs, double sec, double sr)
{
  std::vector<float> y((size_t) (sec * sr));
  const double a = std::pow(10., dbfs / 20.);
  for (size_t i = 0; i < y.size(); i++) y[i] = (float) (a * std::sin(2 * M_PI * hz * i / sr));
  return y;
}

static std::vector<float> Hits(const std::vector<double>& atSec, double sr, double len = 1.0)
{
  std::vector<float> y((size_t) (len * sr), 0.f);
  Rng g(3);
  for (double t0 : atSec)
    for (size_t i = (size_t) (t0 * sr); i < y.size(); i++)
    {
      const double t = i / sr - t0;
      y[i] += (float) (0.5 * g.n() * std::exp(-t / 0.03) + 0.4 * std::sin(2 * M_PI * 190 * t) * std::exp(-t / 0.05));
    }
  return y;
}

int main()
{
  for (double sr : {44100., 48000., 96000.})
  {
    const auto s = Sine(997., -20., 2., sr);
    const double mono = MaxMomentaryLufs({s}, sr, s.size());
    const double stereo = MaxMomentaryLufs({s, s}, sr, s.size());
    printf("sr %6.0f  -20 dBFS 997 Hz: mono %.2f LUFS (-23.01), stereo %.2f LUFS (-20.00)\n", sr, mono, stereo);
    assert(std::fabs(mono + 23.01) < 0.1);
    assert(std::fabs(stereo + 20.00) < 0.1);
  }
  // K-weighting: 100 Hz reads lower than 1 kHz, 6 kHz reads higher (the high shelf)
  {
    const double sr = 48000.;
    const auto lo = Sine(100., -20., 2., sr), hi = Sine(6000., -20., 2., sr);
    const double l = MaxMomentaryLufs({lo}, sr, lo.size()), h = MaxMomentaryLufs({hi}, sr, hi.size());
    printf("100 Hz %.2f LUFS, 6 kHz %.2f LUFS (shelf: 6 kHz louder than 1 kHz)\n", l, h);
    assert(l < -23.01 && h > -23.01 + 3.);
  }

  // druminess: synthetic hits high, a slow riser / pad low
  {
    double kick = 0, snare = 0, fx = 0;
    for (unsigned k = 0; k < 6; k++)
    {
      kick += AnalyzeSample({SynthDrum(kClsKick, k)}, 48000.).druminess / 6;
      snare += AnalyzeSample({SynthDrum(kClsSnare, k)}, 48000.).druminess / 6;
      fx += AnalyzeSample({SynthDrum(kClsFX, k)}, 48000.).druminess / 6;
    }
    const auto pad = AnalyzeSample({Sine(220., -12., 3., 48000.)}, 48000.).druminess;
    printf("druminess: kick %.2f snare %.2f | riser %.2f pad %.2f\n", kick, snare, fx, pad); fflush(stdout);
    assert(kick > .6 && snare > .6 && fx < .35 && pad < .5);
  }

  // late transient: one hit vs two equal hits 80 ms apart vs a soft flam
  {
    const double sr = 48000.;
    const auto one = AnalyzeSample({Hits({0.05}, sr)}, sr).lateTransient;
    const auto two = AnalyzeSample({Hits({0.05, 0.13}, sr)}, sr).lateTransient;
    auto flam = Hits({0.05}, sr);
    const auto second = Hits({0.09}, sr);          // 40 ms later, softer (60 %)
    for (size_t i = 0; i < flam.size(); i++) flam[i] += 0.6f * second[i];
    const auto f = AnalyzeSample({flam}, sr).lateTransient;
    printf("late transient: single %.2f, double %.2f, soft flam %.2f\n", one, two, f); fflush(stdout);
    assert(one < .2 && two > .6 && f > one && f < two);
  }
  printf("measures_test OK\n");
  return 0;
}
