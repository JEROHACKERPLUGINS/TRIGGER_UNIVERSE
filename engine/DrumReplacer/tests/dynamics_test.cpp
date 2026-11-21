// cd tests && clang++ -std=c++17 -I.. dynamics_test.cpp -o /tmp/dyn && /tmp/dyn
#include "DSP/Dynamics.h"
#include <cassert>
#include <cmath>
#include <cstdio>

static bool near(double a, double b) { return std::fabs(a - b) < 1e-4; }

int main()
{
  // Velocity curve
  assert(near(ShapeVelocity(0.5f, 50., 100.), 0.5));          // linear
  assert(ShapeVelocity(0.5f, 100., 100.) > 0.8f);              // lifts soft hits
  assert(ShapeVelocity(0.5f, 0., 100.) < 0.1f);                // pushes them down
  assert(near(ShapeVelocity(1.f, 0., 100.), 1.));              // full hit stays full
  // Dynamics
  assert(near(ShapeVelocity(0.2f, 50., 0.), 1.));              // 0% = no dynamics
  assert(near(ShapeVelocity(0.2f, 50., 50.), 0.6));            // halfway

  // Gate: closed at floor, opens over attack, closes over release
  HitGate g;
  g.Reset();
  assert(near(g.Process(10., 20., 0.25), 0.25));
  g.Trigger();
  double v = 0.;
  for (int i = 0; i < 10; i++) v = g.Process(10., 20., 0.25);
  assert(near(v, 1.));
  for (int i = 0; i < 20; i++) v = g.Process(10., 20., 0.25);
  assert(near(v, 0.25));
  // Zero attack opens instantly
  g.Trigger();
  assert(near(g.Process(0., 20., 0.), 1.));

  puts("dynamics_test: OK");
}
