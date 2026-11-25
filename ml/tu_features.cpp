// TRIGGER UNIVERSE · feature extractor for training the pre-trained classifier.
//
// Runs the plugin's own recognition engine (AnalyzeSample + RawFeatureRow) on a
// list of WAV files, so the model is trained on exactly the numbers the plugin
// computes at runtime.
//
//   g++ -std=c++17 -O2 -I../engine/DrumReplacer tu_features.cpp -o tu_features
//   ./tu_features ROOT LIST.tsv OUT.csv [shard nShards]
//
// LIST.tsv: "size<TAB>relative/path.wav" per line (line number = file id).
// OUT.csv : id,ok,durMs,ruleCls,ruleConf,f0..f57   (appends; ids already in OUT are skipped,
//           so an interrupted run resumes where it stopped).
#include "DSP/SampleAnalysis.h"
#include "DSP/SampleMap.h"
#include "DSP/WavFile.h"
#include <cstdio>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

// Same as ReadWavInfo in DrumReplacer.cpp: duration from the header (the decode is cut at 8 MB).
static double WavDurMs(const std::string& path)
{
  std::ifstream f(path, std::ios::binary);
  if (!f) return 0;
  char riff[4] = {}, wave[4] = {};
  uint32_t riffSize = 0;
  f.read(riff, 4); f.read((char*) &riffSize, 4); f.read(wave, 4);
  if (std::string(riff, 4) != "RIFF" || std::string(wave, 4) != "WAVE") return 0;
  uint32_t byteRate = 0, dataSize = 0;
  while (f)
  {
    char id[4] = {}; uint32_t size = 0;
    f.read(id, 4); f.read((char*) &size, 4);
    if (!f) break;
    const std::string cid(id, 4);
    if (cid == "fmt ")
    {
      uint16_t fmt, ch, ba, bits; uint32_t sr;
      f.read((char*) &fmt, 2); f.read((char*) &ch, 2); f.read((char*) &sr, 4); f.read((char*) &byteRate, 4);
      f.read((char*) &ba, 2); f.read((char*) &bits, 2);
      if (size > 16) f.seekg((std::streamoff) size - 16, std::ios::cur);
    }
    else if (cid == "data") { dataSize = size; break; }
    else f.seekg((std::streamoff) size + (size & 1), std::ios::cur);
  }
  return byteRate > 0 && dataSize > 0 ? (double) dataSize / byteRate * 1000. : 0;
}

int main(int argc, char** argv)
{
  if (argc < 4) { std::cerr << "usage: tu_features ROOT LIST.tsv OUT.csv [shard nShards]\n"; return 1; }
  const std::string root = argv[1];
  const int shard = argc > 5 ? std::atoi(argv[4]) : 0, nShards = argc > 5 ? std::atoi(argv[5]) : 1;

  std::set<long> done;
  { std::ifstream in(argv[3]); std::string line;
    while (std::getline(in, line)) if (!line.empty() && line.back() != ',') done.insert(std::atol(line.c_str())); }

  std::ifstream list(argv[2]);
  FILE* out = std::fopen(argv[3], "a");
  if (!list || !out) { std::cerr << "cannot open list/output\n"; return 1; }
  std::string line; long id = -1, n = 0;
  double row[tu::kRawFeatSize];
  while (std::getline(list, line))
  {
    id++;
    if (id % nShards != shard || done.count(id)) continue;
    const auto tab = line.find('\t');
    const std::string path = root + "/" + (tab == std::string::npos ? line : line.substr(tab + 1));
    std::vector<std::vector<float>> ch; double sr = 0;
    bool ok = false;
    tu::SampleFeatures f;
    try
    {
      if (LoadWavFile(path, ch, sr, 8u << 20) && !ch.empty() && sr > 0)
      {
        f = tu::AnalyzeSample(ch, sr, WavDurMs(path));
        ok = f.ok && f.centroid > 0;
      }
    }
    catch (...) { ok = false; }
    if (!ok) { std::fprintf(out, "%ld,0,0,-1,0\n", id); continue; }
    float feat[tu::kFeatSize];
    std::copy(f.fp, f.fp + tu::kFpSize, feat); std::copy(f.desc, f.desc + tu::kDescSize, feat + tu::kFpSize);
    tu::RawFeatureRow(feat, f.durMs, row);
    std::fprintf(out, "%ld,1,%.3f,%d,%.4f", id, f.durMs, f.cls, f.conf);
    for (double v : row) std::fprintf(out, ",%.6g", v);
    std::fprintf(out, "\n");
    if (++n % 200 == 0) std::fflush(out);
  }
  std::fclose(out);
  return 0;
}
