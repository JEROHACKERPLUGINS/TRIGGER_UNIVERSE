#pragma once

#include <algorithm>
#include <cmath>

// Per-slot hit gain from the detected velocity (0..1).
//  - Velocity curve: 50% = linear, 100% = lifts soft hits (v^0.25), 0% = pushes them down (v^4).
//  - Dynamics: 100% = full velocity range, 0% = every hit at full level.
inline float ShapeVelocity(float velocity, double veloCurvePct, double dynamicsPct)
{
  const double exponent = std::pow(2., (50. - veloCurvePct) / 25.);
  const double shaped = std::pow(std::clamp((double) velocity, 0., 1.), exponent);
  const double dyn = std::clamp(dynamicsPct * 0.01, 0., 1.);
  return (float) (1. - dyn + dyn * shaped);
}

// Gain of one triggered hit, same as the prototype (playSlot in app.js):
//   SENSITIVITY sets the dynamic range (like Trigger 2): 0 % squeezes soft and hard
//   hits together (exponent 0.35), 100 % spreads them apart (exponent 2.0).
//   The slot's VELOCITY amount blends that response with a fixed level.
// velocity = the detector's peak level (0..2, full scale = 1).
inline float TriggerGain(float velocity, double sensitivityPct, double velocityAmountPct)
{
  const double dynExp = 0.35 + std::clamp(sensitivityPct, 0., 100.) / 100. * 1.65;
  const double dynamics = std::pow(std::clamp((double) velocity, 0., 2.), dynExp);
  const double amount = std::clamp(velocityAmountPct / 100., 0., 1.);
  return (float) std::clamp(1. - amount + amount * dynamics, 0., 2.2);
}

// Transient gate on the original (dry) signal, keyed by detected hits: each hit opens it
// over Attack, then it closes over Release down to the Sustain floor. Cuts bleed between
// hits when you blend in the original. Pro only.
// ponytail: our reading of the original's Attack/Sustain/Release; adjust once compared.
class HitGate
{
public:
  void Reset() { mEnv = 0.; mPhase = kClosed; }
  void Trigger() { mPhase = kAttack; }

  // Gain for one sample. Times in samples, floor 0..1.
  double Process(double attackSamples, double releaseSamples, double floor)
  {
    switch (mPhase)
    {
      case kAttack:
        mEnv += attackSamples > 1. ? 1. / attackSamples : 1.;
        if (mEnv >= 1. - 1e-9) { mEnv = 1.; mPhase = kRelease; }
        break;
      case kRelease:
        mEnv -= releaseSamples > 1. ? 1. / releaseSamples : 1.;
        if (mEnv <= 1e-9) { mEnv = 0.; mPhase = kClosed; }
        break;
      case kClosed:
        break;
    }
    return floor + (1. - floor) * mEnv;
  }

private:
  enum EPhase { kClosed, kAttack, kRelease };
  double mEnv = 0.;
  EPhase mPhase = kClosed;
};
