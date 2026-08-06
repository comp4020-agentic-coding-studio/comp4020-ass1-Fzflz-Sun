# Model assumptions — GRIP IS A BUDGET

This is a teaching model, not a vehicle-dynamics reference. Every number
below is chosen to make the shared grip-budget idea legible at one corner,
one speed, one car — not to match a real car. Values live in
`src/simulation/constants.ts`; keep this file and that one in sync.

## What the model is

A 3-degree-of-freedom bicycle (single-track) model: longitudinal velocity,
lateral velocity, and yaw rate, integrated on a fixed timestep
(`FIXED_TIMESTEP = 1/120s`). Each axle has a linear tyre model
(`Fy = -C·α`, slip angle `α` from `atan2` of the axle's local velocity
components) and a friction-circle limit: `utilisation = |F| / (μ · Fz)`,
clamped to the circle boundary (direction preserved) once `utilisation > 1`.
Steering, throttle, and braking all add force demand onto this same clamped
budget; drivetrain only changes which axle receives the throttle share.

## Tuned constants and why

- **`maxSteerAngle = 0.045 rad` (~2.6°).** Not a literal wheel angle — the
  smallest value that made "full steering lock" a bounded fraction of the
  friction circle rather than an instant, drivetrain-independent overload of
  both axles. See "What went wrong first" below.
- **`maxEngineForce = 4200 N`.** Tuned so full throttle alone, on dry
  surface, sits comfortably under one axle's limit (~71%). The pedagogical
  point is that *combining* throttle with cornering demand on the same axle
  tips it over — not that throttle alone is already enough.
- **`corneringStiffnessFront = corneringStiffnessRear = 80,000 N/rad`.**
  Symmetric by default, so any front/rear asymmetry the driver sees comes
  from drivetrain and surface choice, not a hidden tyre-stiffness thumb on
  the scale.
- **`brakeFrontShare = 0.6`.** One illustrative fixed bias, not a claim about
  any real car's brake balance.
- **`minSpeedForSlip = 3 m/s`.** Floors the speed used inside the slip-angle
  `atan2` calls only (not the car's real velocity) so the linear tyre
  model's effective stiffness (`(Cf+Cr)/(m·vx)`) doesn't approach the
  fixed-timestep Euler-integration stability boundary as the car slows.
- **`SURFACE_PRESETS` (dry `μ=1.0`, wet `μ=0.7`, ice `μ=0.3`).** A relative,
  illustrative ordering — not measured coefficients for any real compound,
  temperature, or water/ice depth.

## What went wrong first, and what that changed

Three bugs were found and fixed before this model was trustworthy, and all
three are worth recording because they'd be easy to reintroduce by "fixing"
a symptom instead of the cause:

1. **The tyre lateral force had the wrong sign on both axles.** Slip angle
   here is defined as `α = (steer angle) − (velocity angle)` — the negative
   of the SAE convention — which means the force that actually opposes the
   tyre's slip velocity is `Fy = +C·α`, not the more commonly quoted
   `Fy = −C·α`. The model originally used `-C·α` for both axles, which
   doesn't just mirror the turn: it turns a restoring (stabilising) force
   into an amplifying one. Under that bug, *any* sustained cornering input,
   at almost any steering angle, spun the car out within a few hundred
   milliseconds — a positive-feedback loop, not a friction-limit problem —
   and no amount of retuning `maxSteerAngle`, `corneringStiffness`, or
   `yawInertia` could fix it, because the sign error made the linearised
   yaw-rate dynamics unstable on their own, before the friction circle ever
   entered the picture. It was found by deriving the front/rear force from
   first principles (a tyre's lateral force resists its lateral velocity
   *in its own heading frame*) and comparing that to the code term by term.
   Fixing the sign turned an unstable spin into what a corner like this
   should actually look like: FWD settles into a stable, bounded understeer
   that can be held indefinitely; RWD settles into oversteer that is
   noticeably less stable and eventually gives way to a slide if held long
   enough — matching real driving intuition instead of contradicting it.
2. **Flooring `vx` at exactly zero deleted a restoring term.** The
   integrator originally clamped forward velocity to `max(0, vx)`. Once a
   hard, sustained slide drove `vx` to that floor, the `-vx · yawRate` term
   in the lateral-velocity equation vanished, so nothing bounded lateral
   velocity — it grew without limit instead of settling into a bounded
   slide. Fix: `vx` is only capped at the top-speed safety limit, and can go
   negative (a spun car's body-frame forward velocity legitimately can); a
   hard cap on total speed (`hypot(vx, vy) ≤ maxSpeed`) is the actual safety
   net against the linear tyre model's known invalidity at extreme slip.
   This was found — and looked like a complete fix at the time — *before*
   bug 1 above; it's a real, separate bug, but it was masking how deep the
   sign error's instability went.
3. **`maxSteerAngle = 0.5 rad` (28.6°) demanded far more lateral force than
   either axle's limit could supply, instantly, regardless of drivetrain.**
   This was a real contributor when tuning against the sign bug above, but
   it was treating a symptom: at a merely large (not absurd) angle, the
   sign bug alone was enough to spin the car out. `maxSteerAngle` was cut
   to 0.045 rad while chasing this, and stayed there after the sign fix
   because it still produces a clean, legible demonstration — but the
   headroom argument in the constants file predates the real fix and is
   more conservative than strictly necessary now.

## Standing disclosures (never contradict these)

- FWD does not always understeer, RWD does not always oversteer, and AWD
  cannot slide — drivetrain changes *which axle carries the longitudinal
  share*, not the outcome. A sustained-enough demand saturates any axle,
  any drivetrain.
- Dry/wet/ice are a relative, illustrative ordering, not a universal
  friction coefficient.
- Holding full lock and full throttle is not symmetric in how long it stays
  legible, and that asymmetry is itself part of the point: a saturated
  front axle (understeer) is a dynamically stable condition and can be held
  indefinitely without the car spinning, but a saturated rear axle
  (oversteer) is inherently less stable and will eventually give way to a
  four-wheel slide the longer it's held — the same asymmetry between
  understeer and oversteer that real drivers experience, not a bug specific
  to one drivetrain. Any axle, on any drivetrain, still slides if pushed
  hard enough for long enough.
