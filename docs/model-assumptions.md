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

- **`maxSteerAngle = 0.08 rad` (~4.6°).** Not a literal wheel angle — it is
  calibrated together with each `TRACK_PRESETS` entry's `radius`,
  `wheelbaseHalf`, and `ENTRY_SPEED` as one scenario, not a standalone tuning
  knob, and is left unchanged across every track preset so a tighter track is
  expressed entirely as "more of the same fixed steering budget" (see the
  track presets section below), not a different steering ceiling per track.
  A 2.6 m wheelbase following the default sweep's 45 m-radius corner needs
  roughly `atan(2.6/45) ≈ 0.058 rad` of kinematic steer angle just to match
  the road's own curvature; `DRY_BASELINE_STEERING_FRACTION` of this value
  lands close to that requirement, so the documented dry baseline (~70%
  steering) tracks the reference line, full lock tightens the line further,
  and there is still headroom below full lock before the front axle's
  lateral capacity is exhausted. The previous value (0.045 rad) was
  geometrically incapable of reaching the required curvature at *any*
  steering fraction — the corner was always run wide regardless of input,
  independent of and in addition to the sign bug in "What went wrong first"
  below.
- **`ENTRY_SPEED = 12 m/s` (~43 km/h).** The speed a run starts at once the
  driver presses "Enter the corner" (`startRun`). Calibrated with every
  track's radius and `maxSteerAngle` above: fast enough that the corner is a
  real driving problem, slow enough that the dry baseline's required lateral
  force stays under each axle's friction-circle limit on its own, on every
  track preset.
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
- **`minSpeedForSlip = 3 m/s`.** Floors *only* the speed used inside the
  slip-angle `atan2` calls, so the linear tyre model's effective stiffness
  (`(Cf+Cr)/(m·vx)`) doesn't approach the fixed-timestep Euler-integration
  stability boundary as the car slows. It must never gate whether braking,
  rolling resistance, or the low-speed lateral-force fade apply — those three
  always read the car's actual `vx`, never this floored value. (See "What
  went wrong first" below — conflating this floor with "the car can't really
  stop" was bug #4.)
- **`ROLLING_RESISTANCE_FORCE = 400 N`.** A modest constant force, always
  opposing the car's current direction of travel while `|vx| > AT_REST_SPEED`,
  independent of the brake pedal. Without it, a coasting car (zero throttle,
  zero brake) never decelerates: nothing in `vxDot` opposes motion unless the
  driver brakes, so releasing every pedal left the car cruising forever at
  whatever speed it last reached.
- **`LOW_SPEED_FADE_SPEED = 1.0 m/s`.** Below this forward speed, lateral
  tyre force is scaled toward zero (independent of `minSpeedForSlip`). At
  `vx = 0`, `minSpeedForSlip`'s atan2 floor still leaves `alpha` equal to the
  raw steer angle, which without this fade would let steering a stationary
  car manufacture real cornering force out of nothing.
- **`AT_REST_SPEED = 0.05 m/s`.** The threshold below which rolling
  resistance stops applying (there is nothing left for it to oppose). The
  car's actual snap-to-rest behaviour is a *sign* comparison in `physics.ts`,
  not a speed threshold — see bug #4 below for why a threshold alone isn't
  enough.
- **`DRY_BASELINE_STEERING_FRACTION = 0.7`.** The documented "dry baseline"
  cornering input referenced in `spec/brief.md` and used throughout the red
  behavioural tests — not a UI default; the driver can still steer anywhere
  in `[-1, 1]`. Chosen so the front axle's lateral demand at this fraction
  stays under its friction-circle limit even though full lock alone can now
  saturate an axle outright (since `maxSteerAngle` above was raised), making
  it a safe "unsaturated" comparison baseline.
- **`SURFACE_PRESETS` (dry `μ=1.0`, wet `μ=0.7`, ice `μ=0.3`).** A relative,
  illustrative ordering — not measured coefficients for any real compound,
  temperature, or water/ice depth.
- **`TRACK_PRESETS` — four discrete track/corner presets** (`sweep-left`,
  `sweep-right`, `hairpin-left`, `hairpin-right`), the second, free
  demonstration of the shared-budget idea: a smaller corner radius demands
  more lateral force at the same speed, so it saturates sooner than a gentle
  sweep under otherwise-identical drivetrain/surface/throttle settings — no
  new physics, just a tighter circle to hold. Each preset is a calibrated
  bundle, not independently tunable fields:
  - `sweep-left`/`sweep-right`: `radius = 45 m`, `sweepAngle = π/2` (90°),
    `autosteerFraction = DRY_BASELINE_STEERING_FRACTION = 0.7`,
    `expectedTraversalSeconds ≈ 5.9`. Reproduces the original single-track
    prototype's exact geometry (`sweep-right` is `DEFAULT_TRACK_ID`).
  - `hairpin-left`/`hairpin-right`: `radius = 40 m`, `sweepAngle = 5π/6`
    (150°, a tight, sustained U-turn), `autosteerFraction = 0.81`,
    `expectedTraversalSeconds ≈ 8.7`. At the same speed this is a ~12.5%
    higher `v²/r` lateral demand than the sweep, on top of a steering input
    that alone already uses more (81% vs 70%) of the fixed steering budget —
    together this reaches saturation at a lower throttle intensity, or
    sooner in the run, than the identical settings do on a sweep.
  - Each `autosteerFraction` is derived the same way
    `DRY_BASELINE_STEERING_FRACTION` was: `atan(wheelbase / radius) /
    maxSteerAngle`, with `wheelbase = 2 × CAR_PARAMS.wheelbaseHalf = 2.6 m`
    and `maxSteerAngle` left unchanged across every preset.
  - `"left"`/`"right"` of the same sharpness are exact mirror images — only
    `direction` differs, produced by a single sign flip on `trackCentre` /
    `referenceCurvature` / `sweptAngleRate` (`track.ts`) and on the signed
    autosteer target (`inputs.ts`). The friction/tyre model has no
    direction-dependent asymmetry, so mirroring never needed separately-tuned
    physics.
  - `sweepAngle` is what gives every track a finite, deliberately completed
    length instead of the old unbounded arc: sized, together with `radius`
    and `ENTRY_SPEED`, so the documented entry speed brings the car to the
    end of the arc in a legible few seconds.
    `expectedTraversalSeconds` is the coasting estimate used for that
    *sizing*, not the finish trigger itself — see the lifecycle section
    below for how `Finished` is actually reached.
- **`SAFETY_CAP_SECONDS = 20`.** A generous backstop duration that
  force-finishes a run regardless of position, so a pathological settings
  combination (e.g. a stalled car on ice that never reaches the end of its
  track) can't leave a run stuck `"running"` forever. This is a safety net,
  *not* the primary finish trigger — see `shouldFinish` in the lifecycle
  section below — sized comfortably above the slowest realistic traversal
  (the hairpin, ~8.7s expected).
- **`THROTTLE_INTENSITY_PRESETS` (light `0.4`, medium `0.7`, full `1.0`,
  each a fraction of `maxEngineForce`).** Same discipline as
  `SURFACE_PRESETS` — a documented teaching ordering, not a claim about a
  real accelerator pedal's travel.
- **`THROTTLE_TIMING_PRESETS` (early `0s`, mid `2.5s`, late `4.5s` elapsed
  run time before throttle starts ramping in).** The demonstrative piece of
  the discrete-run redesign: kinematic curvature from the fixed autosteer
  target is speed-independent, but the *lateral force needed* to hold that
  curvature scales with `vx²`, and `ROLLING_RESISTANCE_FORCE` steadily bleeds
  speed off the car while it coasts. So lateral demand is highest right after
  corner entry and eases the longer the car coasts — applying the same
  throttle intensity "early" stacks longitudinal demand on top of that peak
  lateral demand and saturates an axle sooner than the identical intensity
  applied "late". This falls directly out of the existing, untouched
  friction-circle model; it required no change to `physics.ts`. Calibrated
  together with every `TRACK_PRESETS` entry's `expectedTraversalSeconds` and
  `throttleRampPerSecond`: "late" still leaves at least ~1.5s of runway —
  more than the ~0.83s full-throttle ramp — before even the shortest track
  (the sweep, ~5.9s) finishes, so the contrast is visible on every preset,
  not just the longer hairpin.

## Experiment lifecycle

The visitor never drives in real time. Before a run, they choose five
discrete settings — drivetrain, surface, throttle intensity, throttle
timing, and track — each a `<button>` with a `data-testid`, never a held key
or pointer control. Pressing the explicit `data-testid="start-run"` control
(`startRun`) sets the car to `ENTRY_SPEED` and flips the phase from `"ready"`
(or `"finished"`) to `"running"`; the car does not move on page load or
after Reset, or ever between runs — `createInitialState` returns phase
`"ready"`, and `step` is a no-op while `phase !== "running"`. This exists
because an inert "ready" state and a moving "running" state look identical
to a test that only checks utilisation percentages and state labels — see
bug #5 below.

Once running, the car's whole control input — steering *and* throttle — is
computed by `controlsAtElapsed(elapsed, throttleIntensity, throttleTiming,
params, track)` (`inputs.ts`): a pure, closed-form function of elapsed run
time, not an iterative accumulation of held-button state. Steering always
ramps toward the *selected track's own* fixed autosteer target
(`track.autosteerFraction`, signed by `track.direction`) at
`steerRampPerSecond`, from the instant the run starts — it is never a
second variable the visitor adjusts directly (they only pick which track to
autosteer around), so any behavioural difference between two runs is
attributable to the settings that changed, not to how well the visitor
steered. Throttle stays at exactly 0 until the selected timing threshold,
then ramps toward the selected intensity fraction at `throttleRampPerSecond`.
Brake is always 0 — braking is out of scope for this interaction model.
Because both ramps are pure functions of elapsed time and the settings, the
same (drivetrain, surface, intensity, timing, track) tuple reproduces
bit-for-bit identical output on every run.

A run reaches `"finished"` **positionally**, not after a fixed duration:
each step accumulates `SimState.sweptAngle` (via `sweptAngleRate`,
`track.ts` — the signed rate the car's position vector is sweeping around
the track's centre of curvature), and `shouldFinish` (`physics.ts`) flips
the phase to `"finished"` once `sweptAngle` reaches the selected track's own
`sweepAngle` — i.e. once the car has actually travelled the length of the
track it's on, not just "some fixed number of seconds have passed
regardless of what the car did". `SAFETY_CAP_SECONDS` is a backstop, not the
primary trigger: it only fires if a pathological combination (e.g. a stalled
car on ice) would otherwise never complete the arc. The car holds its
settled state at `"finished"` — `step` no-ops exactly as it does in
`"ready"`. The five setting pickers are disabled only while
`phase === "running"`, and re-enable the instant it reaches `"finished"`, so
a run in progress can't be given an inconsistent mix of two configurations.
Pressing `data-testid="start-run"` again works identically from `"ready"` or
`"finished"` — no forced Reset in between — which is the entire "change one
setting and compare" mechanic: pick a new value, press Run, and see a fresh,
independent run under the new settings. `data-testid="reset"` remains
available in every phase and always returns to the deterministic inert
`"ready"` state.

## What went wrong first, and what that changed

Five bugs were found and fixed before this model was trustworthy, and all
five are worth recording because they'd be easy to reintroduce by "fixing"
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
   more conservative than strictly necessary now. It was in fact still too
   conservative in a different way: 0.045 rad turned out to be geometrically
   incapable of matching this corner's own curvature at any steering
   fraction, which is why `maxSteerAngle` was later recalibrated to 0.08 rad
   (see "Tuned constants and why" above) — a distinct problem from the
   friction-circle headroom this section was originally about.
4. **The car could brake toward zero but never actually reach or hold it.**
   `minSpeedForSlip` (a floor meant only for the `atan2` slip-angle
   denominator) was also being used, elsewhere, to decide whether braking
   force applied at all — below it, braking silently switched off, so the
   car coasted at a small residual speed forever instead of stopping. There
   was also no rolling resistance, so a car with no pedals held at all never
   decelerated either. Fixed by (a) adding a constant `ROLLING_RESISTANCE_FORCE`
   that always opposes motion above `AT_REST_SPEED`, independent of the brake
   pedal, and (b) a kinematic rest-clamp in `step` that detects "no drive
   force requested, and this timestep's integration either left `vx` at
   exactly zero or pushed its sign past zero" and snaps `vx`/`vy`/`yawRate`
   to exactly zero in that case. A plain speed threshold isn't enough here:
   `fxTotal`'s sign is fixed by the pedal, not by the car's current direction
   of travel, so a single large timestep can integrate straight through zero
   and start accelerating backwards — comparing signs catches that
   regardless of timestep size or how close to zero `vx` already is.
5. **Page load and Reset launched the car immediately, with no input.**
   `createInitialState` used to return a car already moving at speed, and
   `step` would keep integrating it every frame from the moment the page
   loaded — so "no input yet" and "driving normally" were indistinguishable
   to any test that only checked utilisation percentages and state labels
   (both read "stable" either way). Fixed by adding the `"ready"`/`"running"`
   lifecycle phase above: `step` no-ops until the driver explicitly calls
   `startRun`, so the car now visibly waits at rest until asked to move.

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
