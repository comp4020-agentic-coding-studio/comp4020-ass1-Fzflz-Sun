# Assignment 1 brief

This narrows the course's fixed contract (below) down to this one prototype.
Write it with the agent, not for it: hand it the draft, ask what's ambiguous,
what you're assuming, what "done" means for each line — then edit the result
yourself. This file is expected to change during the week; if it survives
untouched, either the job was tiny or nobody read it.

## The fixed contract (from the assessment page, doesn't change)

1. Deployed and live at its public GitHub Pages URL by the deadline.
2. Static and client-side throughout, and the starter's invariant checks pass.
3. Works at both marking viewports (desktop 1920×1080, phone 390×844).
4. The visitor does something that changes what they see — stated plainly
   enough to write a test for it.
5. One strong idea with a point of view, and nothing else.
6. Process evidence in the repo: PROCESS.md, CLAUDE.md, reflections/assignment-1.md,
   a commit history that grew with the work.

## This prototype: GRIP IS A BUDGET

- **The idea**: every tyre has one finite grip budget, and steering,
  acceleration, and braking all draw on that same budget — not on separate
  supplies of force — so the axle that runs out first, not the drivetrain
  label, decides how the car leaves the intended line.
- **The shape**: a top-to-bottom scrolling explorable, not a single dashboard.
  A non-interactive intro states the thesis once; five fixed-order teaching
  modules each isolate *one* variable at a time (everything else held
  constant) with its own question, its own tiny experiment, and a conclusion
  written from that run's own real result; a final sandbox is the only place
  every variable is free to combine. This progressive-disclosure structure
  (question → small isolated experiment → short conclusion, repeated) is
  modelled on the shape of explorables like *Parable of the Polygons* —
  without copying its code, art, or characters — chosen because the shared
  grip-budget idea is really five separable claims (corner shape, surface,
  throttle intensity, drivetrain, throttle timing), each clearer proven alone
  than buried in one screen with all five knobs live at once.
- **The mechanic**: one car, driven by a single deterministic autosteer +
  throttle script configured *before* it runs, never by real-time driving
  input. Steering is always the same fixed autosteer program calibrated to
  whichever corner is selected (never a second variable to control for).
  Across the whole page there are five settings — drivetrain (FWD/RWD/AWD),
  surface (dry/wet/ice), throttle intensity (Light/Medium/Full), throttle
  timing (Early/Mid/Late, i.e. how soon into the run throttle starts ramping
  in), and track (Sweep left/right, Hairpin left/right) — but only the
  sandbox exposes all five at once; each teaching module exposes exactly one,
  with the other four fixed to a documented baseline for that module. Every
  module and the sandbox is its own independent experiment instance (own
  state, own canvas, own Run/Reset, own result text) — changing one module's
  setting or running it never changes any other module's displayed state.
  Steering and throttle demand are combined per axle through a friction-circle
  limit (`utilisation = sqrt((Fx/FxLimit)^2 + (Fy/FyLimit)^2)`), and the
  drivetrain choice only changes *which axle* carries the longitudinal share.
  When utilisation on an axle exceeds 1, that axle's achievable force clamps,
  and the car visibly runs wide (front saturates) or rotates (rear
  saturates).
- **The five teaching modules, in fixed order** (each a one-variable
  comparison, everything else held fixed):
  1. **Corner** (Sweep vs. Hairpin) — a tighter corner demands more lateral
     force at the same speed than a gentle sweep, so it alone saturates an
     axle sooner under otherwise-identical settings — no new physics, just a
     smaller radius to hold.
  2. **Surface** (Dry/Wet/Ice) — a lower-grip surface shrinks the whole
     budget, so the identical script reaches saturation sooner (or at all)
     on ice than on dry.
  3. **Throttle intensity** (Light/Medium/Full) — asking for more
     longitudinal force stacks on top of whatever lateral force the corner is
     already spending on the driven axle.
  4. **Drivetrain** (FWD/RWD/AWD) — moves *which* axle carries the
     longitudinal share; it doesn't create more total grip. AWD splits that
     share across both axles, delaying saturation, not eliminating it.
  5. **Throttle timing** (Early/Mid/Late) — lateral demand from cornering is
     highest right after corner entry and eases as the car coasts, so the
     same throttle intensity applied *early* stacks on that peak and
     saturates an axle sooner than the identical intensity applied *late*.
- **The sandbox**: the only place all five settings are free to combine, via
  an inline mad-libs sentence of native `<select>` elements ("Drive a
  ‹rear-wheel-drive› car on a ‹dry› surface, applying ‹medium› throttle
  ‹before the apex› of a ‹sweeping corner›."), an `Advanced setup` disclosure
  for corner direction, and a collapsible `Telemetry` disclosure holding the
  full instrument panel (state, motion, axle budgets, G-G, autosteer/throttle
  now) that no teaching module repeats in full. The primary button reads "Run
  experiment", then relabels to "Run again" after first use; Reset is
  visually secondary.
- **The core interaction, stated testably**: every module (and the sandbox)
  sits at rest indefinitely on load or after its own
  `data-testid="reset"` — nothing moves until the visitor presses that
  module's own `data-testid="start-run"`, which enters the selected corner at
  a documented entry speed and plays back a fully deterministic run using
  whatever settings are currently selected *for that module*. Over that run,
  that module's own `data-testid="front-utilisation"` and/or
  `data-testid="rear-utilisation"` rise, and `data-testid="speed"` shows the
  car actually moving; once combined demand exceeds 100% on an axle, that
  module's own `data-testid="state-label"` changes from `Stable` to
  `Understeer`, `Oversteer`, or `Four-wheel slide`, and a plain-language
  result sentence is written into `data-testid="module-result"` — computed
  from that run's own real final numbers, never a pre-written line. Every
  track has an explicit, finite length; a run ends positionally once the car
  has actually travelled it (`shouldFinish`), holding the settled final
  state. Pressing `start-run` again from `Finished` — no forced Reset in
  between — starts a fresh, independent run from the current settings, which
  is how a visitor compares one setting change against the last run. A
  module's own setting pickers are disabled only while that module's run is
  in progress, and only that module's — every other module and the sandbox
  stay fully interactive. Scrolling a module out of view pauses its physics
  stepping (and, once far enough away, releases its WebGL context) without
  losing or advancing its state; scrolling back resumes it with no time jump.
- **Audience**: someone with everyday car-passenger intuition (turning,
  speeding up, braking are all familiar) but no vehicle-dynamics background.
  They do not need to know what a friction circle, slip angle, or bicycle
  model is — the explorable teaches the one idea (shared grip budget) through
  driving, not through the underlying maths, and says plainly that it is a
  simplified teaching model, not professional driving instruction.
- **Explicitly excluded**: a run-history or compare-across-runs UI; lap
  timing; other traffic; cockpit view; gear/clutch simulation;
  ABS/ESC/TC; tyre temperature/wear; suspension, differential, or aero
  tuning; detailed dynamic weight transfer (front/rear normal load is fixed
  and symmetric); real vehicle makes or performance claims; downloaded 3D
  models; a long-form tutorial; real-time driving input anywhere on the page,
  including the sandbox (it stays discrete-settings-then-Run, same as every
  module — only *which* settings are free changes). Colliding with *other
  traffic* is excluded, but colliding with the track's own outer barrier is
  not: running wide enough to reach it scrapes the car along the wall rather
  than clipping through — a physical consequence of understeer/oversteer,
  not a second vehicle to avoid. Full exclusion list and rationale in the
  top-level assignment brief this file narrows.
- **Edge cases that matter**: keyboard-only operation (Tab between a
  module's setting pickers and its Run/Reset — there is no continuous
  arrow-key driving to support); touch targets sized and reachable on a
  390×844 phone with no hover dependency; resizing from desktop to phone
  mid-run without losing simulation state or throwing console errors; a
  `prefers-reduced-motion` visitor still gets the full instrument-panel
  explanation, a runnable experiment in every module, and a static (not
  animated) intro/scroll vignette; a visitor who never touches a module's own
  pickers, but does press its `start-run`, still reaches a saturation state
  within that module's default configuration; pressing `start-run` again
  from `Finished` starts a clean independent run rather than continuing or
  accumulating state from the previous one; a module's pickers stay disabled
  for the whole of its own run and re-enable the instant it reaches
  `Finished`; the first screen shows only the intro (no module or sandbox
  control is visible before the visitor scrolls); changing or running one
  module never changes another module's displayed state.

## Model assumptions (must stay visible, not just in code)

The simulation is a deliberately simplified, documented teaching model — see
`docs/model-assumptions.md` and the sandbox's "About this model" disclosure.
It must never claim FWD always understeers, RWD always oversteers, AWD
cannot slide, or that dry/wet/ice map to one universally correct friction
coefficient — the surface presets are illustrative, relative grip conditions
only.

## Checkable vs judged

Machine-checkable (write a test in `spec/assignment-1.test.ts` or
`e2e/viewport.spec.ts`):
- #1 deploy — already covered by the template's CI `deploy` job, nothing new
  to write here.
- #2 invariants — already covered by `spec/invariants.test.ts`, shipped.
- #3 both viewports — `e2e/viewport.spec.ts` (loops the interaction checks
  over both marking viewports).
- #4 the interaction — `spec/assignment-1.test.ts` (asserts the static
  markup contract: the intro exists and shows nothing else on the first
  screen; module-1..5 and the sandbox exist in that document order; each
  module exposes exactly its own one setting group plus Run/Reset; the
  sandbox exposes all five as `<select>`s plus `Advanced setup` and
  `Telemetry` disclosures) plus `e2e/viewport.spec.ts` (asserts the live
  behaviour per module: pressing `start-run` drives real motion and rising
  utilisation, saturation flips the state label, the run settles into
  `Finished`, `start-run` again from `Finished` without Reset starts a fresh
  run, changing one module never touches another's state, and scrolling a
  running module offscreen and back pauses/resumes it without a time jump).
- #6 files exist / commits cite real SHAs — already covered by
  `scripts/check-evidence.ts`, shipped.

Also machine-checkable, in `src/simulation/*.test.ts` (unit, no DOM/WebGL) —
these prove the comparative claim each module makes, at the physics-core
level, independent of any DOM/UI concern:
- FWD/RWD/AWD assign drive demand to the documented axle(s); AWD delays but
  does not eliminate saturation (module 4's claim).
- A lower-grip surface reduces available combined force, so ice saturates at
  or before dry under an identical script (module 2's claim).
- Adding longitudinal demand on top of existing lateral demand raises
  combined utilisation, so full throttle uses more rear grip than light
  throttle under an identical script (module 3's claim).
- The hairpin preset demands more lateral force than the sweep preset at the
  same entry speed (module 1's claim).
- An early throttle onset reaches a given combined-demand threshold no later
  than an identical intensity applied late (module 5's claim).
- Front saturation yields the understeer state; rear saturation yields
  oversteer; both yield four-wheel slide.
- Reset returns to the same deterministic initial state every time; the same
  input sequence produces the same output sequence (no hidden randomness).
- Load and Reset leave the car at rest indefinitely; only `startRun` puts it
  in motion (`src/simulation/behaviour.test.ts`).
- Releasing throttle and brake brings the car to, and holds it at, exactly
  zero speed rather than coasting forever or reversing through zero
  (`src/simulation/behaviour.test.ts`).

Judged by a person, not a test — know you're still on the hook for these at
the crit:
- #5 whether it really is *one* strong idea told five small ways, scoped
  with judgement, not a pile of features or five unrelated demos.
- #4's "plainly enough" — a test passing doesn't mean a given module's
  question, experiment, and conclusion actually read clearly in sequence,
  only that it does what it says it does.
- #6's commit history actually growing with the work, not reconstructed after
  the fact.
- Whether the scrolling structure itself teaches — whether progressive
  disclosure (one variable, one small experiment, one real conclusion, per
  module) actually makes the shared-budget idea *more* legible than the old
  single dashboard did, judged live in a browser at both viewports scrolling
  top to bottom, not by a green test suite.
- Whether the 3D rear-chase scene and instrument panel actually make
  saturation legible in each module's small card — the camera holds a
  stable, travel-heading-aligned frame behind the car (never yawing to the
  body itself) so a saturated axle's slip shows as the chassis visibly
  diverging from that frame; colour, motion, and card scale are all judged
  live, not by a green test suite.
