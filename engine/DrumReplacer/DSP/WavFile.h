#pragma once

#include <cstdint>
#include <cstdio>
#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

// Copied from LReverb (LReverb.cpp LoadWavFile). Keep both in sync if either changes.
// Hand-rolled RIFF/WAVE chunk parser: PCM 16/24/32-bit and IEEE float 32/64-bit,
// plus WAVE_FORMAT_EXTENSIBLE. Returns per-channel float samples in [-1, 1] and
// the file's native sample rate. Not realtime-safe: call off the audio thread.
// maxBytes > 0 reads only the start of the file (previews / analysis of long
// files): the data chunk is then cut to what was read. A data chunk whose size
// runs past the end of the file (common in recorder/DAW exports) is clamped too.
inline bool LoadWavFile(const std::string& path, std::vector<std::vector<float>>& outChannels, double& outSampleRate,
                        size_t maxBytes = 0)
{
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return false;
  std::fseek(f, 0, SEEK_END);
  const long fileSz = std::ftell(f);
  if (fileSz <= 12) { fclose(f); return false; }
  const size_t sz = maxBytes > 0 ? std::min((size_t) fileSz, maxBytes) : (size_t) fileSz;
  std::fseek(f, 0, SEEK_SET);
  std::vector<unsigned char> data(sz);
  const size_t rd = std::fread(data.data(), 1, sz, f);
  fclose(f);
  if (rd != sz) return false;

  if (memcmp(&data[0], "RIFF", 4) != 0 || memcmp(&data[8], "WAVE", 4) != 0) return false;

  auto rdU16 = [&](size_t o) { return (uint16_t)(data[o] | (data[o + 1] << 8)); };
  auto rdU32 = [&](size_t o) { return (uint32_t)(data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)); };

  int fmtTag = -1, nch = 0, bits = 0;
  uint32_t sr = 0;
  std::vector<float> pcm; // interleaved

  size_t pos = 12;
  while (pos + 8 <= data.size())
  {
    uint32_t csz = rdU32(pos + 4);
    size_t body = pos + 8;
    if (body + csz > data.size())
    {
      if (memcmp(&data[pos], "data", 4) != 0) break;
      csz = (uint32_t) (data.size() - body); // truncated / partially read data chunk
      if (bits > 0 && nch > 0) csz -= csz % (uint32_t) ((bits / 8) * nch);
    }

    if (memcmp(&data[pos], "fmt ", 4) == 0 && csz >= 16)
    {
      fmtTag = rdU16(body);
      nch    = rdU16(body + 2);
      sr     = rdU32(body + 4);
      bits   = rdU16(body + 14);
      if (fmtTag == 0xFFFE && csz >= 26)
        fmtTag = rdU16(body + 24); // WAVE_FORMAT_EXTENSIBLE subformat
    }
    else if (memcmp(&data[pos], "data", 4) == 0)
    {
      const unsigned char* raw = &data[body];
      if (fmtTag == 1) // PCM
      {
        if (bits == 16)
        {
          const size_t n = csz / 2;
          pcm.resize(n);
          for (size_t i = 0; i < n; i++)
          {
            int16_t v = (int16_t)(raw[i * 2] | (raw[i * 2 + 1] << 8));
            pcm[i] = v / 32768.0f;
          }
        }
        else if (bits == 24)
        {
          const size_t n = csz / 3;
          pcm.resize(n);
          for (size_t i = 0; i < n; i++)
          {
            int32_t b = raw[i * 3] | (raw[i * 3 + 1] << 8) | (raw[i * 3 + 2] << 16);
            if (b & 0x800000) b -= 0x1000000;
            pcm[i] = b / 8388608.0f;
          }
        }
        else if (bits == 32)
        {
          const size_t n = csz / 4;
          pcm.resize(n);
          for (size_t i = 0; i < n; i++)
          {
            int32_t v = (int32_t)(raw[i * 4] | (raw[i * 4 + 1] << 8) | (raw[i * 4 + 2] << 16) | (raw[i * 4 + 3] << 24));
            pcm[i] = v / 2147483648.0f;
          }
        }
        else { return false; }
      }
      else if (fmtTag == 3) // IEEE float
      {
        if (bits == 32)
        {
          const size_t n = csz / 4;
          pcm.resize(n);
          memcpy(pcm.data(), raw, n * 4);
        }
        else if (bits == 64)
        {
          const size_t n = csz / 8;
          pcm.resize(n);
          for (size_t i = 0; i < n; i++)
          {
            double d;
            memcpy(&d, raw + i * 8, 8);
            pcm[i] = (float) d;
          }
        }
        else { return false; }
      }
      else { return false; }
    }
    pos = body + csz + (csz & 1); // chunks are word-aligned
  }

  if (pcm.empty() || nch <= 0) return false;

  const size_t frames = pcm.size() / (size_t) nch;
  outChannels.assign((size_t) nch, std::vector<float>(frames));
  for (size_t i = 0; i < frames; i++)
    for (int c = 0; c < nch; c++)
      outChannels[(size_t) c][i] = pcm[i * (size_t) nch + (size_t) c];
  outSampleRate = (double) sr;
  return true;
}
