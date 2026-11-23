#pragma once

#include "SlotEngine.h"
#include <list>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

// Decoded preview audio (the first kHeadSec of each sample), kept in memory so a
// sample plays instantly the second time, and the first time once the library
// analysis has gone through it (the analyser fills the cache as it reads every
// file). Least-recently-used entries are dropped above kBudgetBytes.
// Thread-safe: the analysis thread fills it, the UI thread reads it.
class PreviewCache
{
public:
  static constexpr double kHeadSec = 1.0;               // the preview plays <= 0.8 s
  static constexpr size_t kBudgetBytes = 384u << 20;    // ~1000 stereo 48 kHz heads

  using Entry = std::shared_ptr<const SampleData>;

  // Copies the first kHeadSec of the channels (key: path + file size).
  void Put(const std::string& path, long long fileSize,
           const std::vector<std::vector<float>>& chans, double sampleRate)
  {
    if (chans.empty() || sampleRate <= 0.) return;
    auto pData = std::make_shared<SampleData>();
    pData->numChannels = std::min((int) chans.size(), 2);
    const size_t n = std::min(chans[0].size(), (size_t) (kHeadSec * sampleRate));
    for (int c = 0; c < pData->numChannels; c++)
      pData->ch[c].assign(chans[(size_t) c].begin(), chans[(size_t) c].begin() + (long) std::min(n, chans[(size_t) c].size()));
    pData->numFrames = (int) pData->ch[0].size();
    pData->sampleRate = sampleRate;
    if (pData->numFrames < 2) return;
    Insert(Key(path, fileSize), pData);
  }

  // A fresh copy for the PreviewPlayer (which takes ownership), or nullptr.
  SampleData* GetCopy(const std::string& path, long long fileSize)
  {
    Entry e;
    {
      std::lock_guard<std::mutex> lock(mMutex);
      const auto it = mMap.find(Key(path, fileSize));
      if (it == mMap.end()) { mMisses++; return nullptr; }
      mLru.splice(mLru.begin(), mLru, it->second.second); // most recent first
      e = it->second.first;
      mHits++;
    }
    return new SampleData(*e);
  }

  size_t Bytes() const { std::lock_guard<std::mutex> lock(mMutex); return mBytes; }
  size_t Count() const { std::lock_guard<std::mutex> lock(mMutex); return mMap.size(); }

private:
  static std::string Key(const std::string& path, long long size) { return path + '|' + std::to_string(size); }
  static size_t SizeOf(const SampleData& d) { return (size_t) d.numFrames * (size_t) d.numChannels * sizeof(float); }

  void Insert(const std::string& key, Entry e)
  {
    std::lock_guard<std::mutex> lock(mMutex);
    const auto it = mMap.find(key);
    if (it != mMap.end())
    {
      mBytes -= SizeOf(*it->second.first);
      mLru.erase(it->second.second);
      mMap.erase(it);
    }
    mLru.push_front(key);
    mBytes += SizeOf(*e);
    mMap.emplace(key, std::make_pair(std::move(e), mLru.begin()));
    while (mBytes > kBudgetBytes && mLru.size() > 1)
    {
      const auto old = mMap.find(mLru.back());
      mBytes -= SizeOf(*old->second.first);
      mMap.erase(old);
      mLru.pop_back();
    }
  }

  mutable std::mutex mMutex;
  std::list<std::string> mLru;
  std::unordered_map<std::string, std::pair<Entry, std::list<std::string>::iterator>> mMap;
  size_t mBytes = 0;
  size_t mHits = 0, mMisses = 0;
};
