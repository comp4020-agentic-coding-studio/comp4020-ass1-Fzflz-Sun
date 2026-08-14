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
    `expectedTraversalSeconds` is the coasting, no-slip estimate used for
    that *sizing* — and, as of `AUTO_FINISH_GRACE_SECONDS` below, also the
    baseline for the tighter of `shouldFinish`'s two elapsed-based
    backstops. See the lifecycle section below for the full three-tier rule.
- **`AUTO_FINISH_GRACE_SECONDS = 0`.** The practical backstop: if a run is
  still going once `expectedTraversalSeconds` (no added slack) has elapsed
  since it started, `shouldFinish` force-finishes it even though
  `sweptAngle` hasn't reached `sweepAngle` — a car that has run wide, or is
  stuck bouncing off the outer barrier, has by then demonstrably stopped
  making real progress toward the finish, and previously kept "running" for
  a further ~10-15s regardless (up to the old flat `SAFETY_CAP_SECONDS`
  backstop) before ending. Tighter and track-relative, unlike
  `SAFETY_CAP_SECONDS` below.
- **`SAFETY_CAP_SECONDS = 20`.** A generous, track-independent backstop
  duration that force-finishes a run regardless of position, so a
  pathological settings combination (e.g. a stalled car on ice that never
  reaches the end of its track) can't leave a run stuck `"running"` forever.
  This is a safety net, *not* the primary finish trigger — see
  `shouldFinish` in the lifecycle section below — sized comfortably above
  even the slowest realistic traversal's own grace cutoff (the hairpin's
  `8.7 + 0 = 8.7s`), so in practice `AUTO_FINISH_GRACE_SECONDS` above is
  what actually fires for a stuck run, not this.
- **`CROSS_TRACK_GAIN = 0.08 /m` and `HEADING_GAIN = 1.5 /rad`.** The
  closed-loop steering correction's two gains (see the Experiment lifecycle
  section below for the full law) — starting values, hand-tuned while
  driving rather than derived from a formula, same discipline as
  `maxSteerAngle`. Deliberately kept low enough that saturation
  (understeer/oversteer/slide) is still visibly reachable rather than being
  corrected away outright.
- **`CAR_HALF_WIDTH_METERS ≈ 1.48 m`** (`SEDAN_RAW_HALF_WIDTH_METERS (0.75) *
  (2 * CAR_PARAMS.wheelbaseHalf) / 1.32`). Used only for the barrier boundary
  below, never for the friction-circle model. Derived from a direct
  measurement of the rendered sedan's own fitted bounding box (`vehicle.ts`'s
  DEV bbox diagnostic), scaled the same way `scene-scale.ts`'s
  `VEHICLE_SCALE` scales the whole model — physics must not depend on an
  asynchronously-loaded glTF's measured size, so the raw half-width and the
  wheelbase ratio are duplicated here rather than imported. Previously a
  hand-picked "real-world half-width" of `0.9 m` that did not match the
  actual rendered car (~1.48 m), which let the car's visible mesh poke past
  the barrier's inner face while the physics-level boundary looked
  satisfied — a real reported bug, not a hypothetical one.
- **`BARRIER_HALF_THICKNESS_METERS = 0.42 m`.** Half of `environment.ts`'s
  `BARRIER_FALLBACK_SIZE.z` (0.84 m). The real fitted barrier size is only
  known asynchronously at render time (glTF load), but `step()` must stay
  synchronous, so this is a documented constant kept in sync by comment with
  `BARRIER_FALLBACK_SIZE`/`BARRIER_SPEC` — same discipline already used for
  `FRONT_COLOR`/`REAR_COLOR` between `main.css` and `materials.ts`. Confirmed
  against `environment.ts`'s own DEV diagnostic: the barrier's actual fitted
  half-Z came back as `0.421875 m`, within 2mm of this constant — the
  barrier side was not the source of the reported clipping, the car's
  half-width above was.
- **`BARRIER_COLLISION_LIMIT_METERS = ROAD_HALF_WIDTH + KERB_WIDTH_METERS +
  BARRIER_KERB_GAP_METERS - BARRIER_HALF_THICKNESS_METERS ≈ 8.38 m`.** The
  `pathOffset` value of the barrier's inner face, derived from the same
  layout constants `src/rendering/track-geometry.ts` and `environment.ts`
  use to place the road/kerb/barrier visually — relocated into
  `constants.ts` as the single source of truth (`src/simulation/` never
  imports from `src/rendering/`; the rendering files import these back). See
  the Experiment lifecycle section below for how this becomes a physical
  wall, not a render-only check.
- **`BARRIER_RESTITUTION = 0.35`, `BARRIER_IMPACT_FRICTION_FACTOR = 0.5`.**
  The outer barrier's collision *response* (see the Experiment lifecycle
  section below): starting values, hand-tuned while driving, same discipline
  as `CROSS_TRACK_GAIN`/`HEADING_GAIN`.
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

### Rendering: dusk lighting and material brightness (cosmetic, not a model assumption)

Unlike every constant above, these carry no physical claim — they only
control how legible the already-correct 3D scene is to look at. Kept here
anyway for the same "doc and code must never disagree" discipline, and
because they were tuned by the same iterative, verify-don't-guess method.

- **`HEMI_INTENSITY = 1.4`, `AMBIENT_INTENSITY = 1.4`** (`environment.ts`).
  Raised in steps (0.75/0.45 → 0.9/0.6 → 1.1/0.85 → 1.4/1.4) to lift
  shadow-side detail — the car's own cast shadow, and any surface facing away
  from the low dusk sun (`SUN_ELEVATION_RADIANS = 0.32`) — without touching
  `SUN_INTENSITY`/exposure, which would also brighten the sun-facing
  highlights and sky dome toward clipping. Each step was checked against a
  pixel-level average (not eyeballed) of the chase-cam's darkest region — the
  foreground road/ground directly around the car — and of the sky/sun
  highlight, confirming the former kept rising while the latter stayed clear
  of clipping toward flat white.
- **`renderer.toneMappingExposure = 1.9`** (`scene.ts`). Raised alongside the
  above (1.15 → 1.3 → 1.5 → 1.9), same pixel-measurement discipline.
- **`GROUND_COLOR = "#3d4a3f"`, `ROAD_COLOR = "#4c5360"`** (`materials.ts`).
  Lightened alongside the light-intensity changes (`#232a24`/`#2c3038` →
  `#2b332c`/`#343a44` → `#333d35`/`#404652` → final) — light-intensity/
  exposure alone plateaued under 10% measured brightness on the darkest
  region, so the base albedo itself needed lifting too, not just the light
  reaching it. `SKY_TOP_COLOR`/`SKY_HORIZON_COLOR` were deliberately left
  untouched throughout — this is brighter dusk, not a switch to daylight.

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
computed by `controlsForState(state, params, dt)` (`inputs.ts`): a pure
function of the current simulation state (position, heading, elapsed time,
and the visitor's discrete settings), not an iterative accumulation of
held-button state. The visitor never adjusts steering directly — they only
pick which track to autosteer around — so any behavioural difference
between two runs is still attributable to the settings that changed, not to
how well the visitor steered.

Steering is a **closed-loop correction toward the selected track's own
reference arc**, a deliberate, explicitly-requested exception to this
model's original "steering never reacts to the car's actual state" design
(see `CLAUDE.md`). It sums three terms, clamps to `[-1, 1]`, then rate-limits
the result from the *previous* actual `state.steering` at
`steerRampPerSecond` (incrementally, since the target itself now moves every
step rather than being a closed-form function of elapsed time alone):

- **Feedforward** — `directionSign * track.autosteerFraction`, exactly the
  fixed target the original design used, still the dominant term when the
  car is tracking the line cleanly.
- **Cross-track correction** — `directionSign * CROSS_TRACK_GAIN *
  pathOffset(state.x, state.y, track)` (`constants.ts`): pulls the car back
  toward the reference line when it has run wide or tucked in.
- **Heading correction** — `HEADING_GAIN * headingError`, where
  `headingError` is the wrapped difference between the arc's own tangent
  heading at the car's current position and `state.heading`: corrects the
  nose back toward the line's direction of travel after a slide has rotated
  the chassis away from it.

`CROSS_TRACK_GAIN` and `HEADING_GAIN` are starting values, hand-tuned while
driving rather than derived — deliberately kept low enough that
understeer/oversteer/slide saturation states are still visibly reachable and
distinguishable (wheel tint, instruments, path offset) rather than being
fully cancelled by the correction. A gain high enough to erase all
saturation would defeat the model's own teaching purpose, so this is a
judgement call re-checked by driving every drivetrain/surface/throttle
combination known to saturate, not just by unit tests.

Throttle is unchanged: it stays at exactly 0 until the selected timing
threshold, then ramps toward the selected intensity fraction at
`throttleRampPerSecond`. Brake is always 0 — braking is out of scope for
this interaction model. Because `controlsForState` and `step` are both pure
functions of their inputs — with no `Math.random()` and no wall-clock
read — the same (drivetrain, surface, intensity, timing, track) tuple still
reproduces bit-for-bit identical output on every run, even though steering
now depends on the car's own trajectory rather than elapsed time alone.

The car's outer boundary is likewise a physical consequence, not a cosmetic
check: the road and its outer barrier are both defined relative to the same
circular arc, so the barrier is a 1D radial limit on `pathOffset`
(`BARRIER_COLLISION_LIMIT_METERS`, `constants.ts`) rather than literal 3D
mesh collision. `step()` clamps the car's position back onto that boundary
circle whenever it's exceeded, then applies a genuine reaction-force
rebound rather than simply stopping dead: the outward-radial (impact-normal)
component of velocity reverses at `BARRIER_RESTITUTION` of its impact speed,
and the along-the-wall (tangential, "scrape") component is bled off by an
amount that scales with the current surface's own grip (`mu`) via
`BARRIER_IMPACT_FRICTION_FACTOR` — a grippier (dry) surface sheds more of
that sliding speed on contact than an icy one, the same friction-is-relative
spirit as the rest of this model. This applies unconditionally whenever
`phase === "running"`, independent of the closed-loop steering above (a
manually-driven car, if this model ever reopens real-time input, would hit
the same wall the same way). It is not a hard stop or a new run-ending
state — the run continues and still finishes normally via `shouldFinish`.

A run reaches `"finished"` **positionally**, not after a fixed duration:
each step accumulates `SimState.sweptAngle` (via `sweptAngleRate`,
`track.ts` — the signed rate the car's position vector is sweeping around
the track's centre of curvature), and `shouldFinish` (`physics.ts`) flips
the phase to `"finished"` once `sweptAngle` reaches the selected track's own
`sweepAngle` — i.e. once the car has actually travelled the length of the
track it's on, not just "some fixed number of seconds have passed
regardless of what the car did". Two elapsed-based backstops sit behind
that, neither the primary trigger: `AUTO_FINISH_GRACE_SECONDS` past the
track's own `expectedTraversalSeconds` fires for a run that has run wide or
is stuck on the barrier and has stopped making real positional progress,
and the flat `SAFETY_CAP_SECONDS` sits behind *that* as an absolute final
backstop for a pathological combination (e.g. a stalled car on ice) that
somehow outlasts even the per-track grace window. The car holds its settled
state at `"finished"` regardless of which of the three tripped it — `step`
no-ops exactly as it does in `"ready"`. The five setting pickers are
disabled only while `phase === "running"`, and re-enable the instant it
reaches `"finished"`, so a run in progress can't be given an inconsistent
mix of two configurations.
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
