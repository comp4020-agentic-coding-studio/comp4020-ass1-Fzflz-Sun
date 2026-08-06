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
- **The mechanic**: one car, driven by the visitor through one broad, fixed
  corner. Steering sets desired curvature, throttle and brake set longitudinal
  demand; both are combined per axle through a friction-circle limit
  (`utilisation = sqrt((Fx/FxLimit)^2 + (Fy/FyLimit)^2)`) and the drivetrain
  choice (FWD/RWD/AWD) only changes *which axle* carries the longitudinal
  share. When utilisation on an axle exceeds 1, that axle's achievable force
  clamps, and the car visibly runs wide (front saturates) or rotates (rear
  saturates).
- **The core interaction, stated testably**: the car sits at rest
  indefinitely on load or after `data-testid="reset"` — nothing moves until
  the visitor presses `data-testid="start-run"` to enter the corner at a
  documented entry speed. Holding the throttle control (button, pointer,
  `ArrowUp`/`W`) while the steering control is deflected
  (`ArrowLeft`/`ArrowRight`/`A`/`D`, or the on-screen steering control)
  increases `data-testid="front-utilisation"` and/or
  `data-testid="rear-utilisation"` in the instrument panel in real time, and
  `data-testid="speed"` and `data-testid="path-offset"` show the car actually
  moving and departing from the reference line, not just the percentages
  changing; once combined demand exceeds 100% on an axle,
  `data-testid="state-label"`'s text changes from `Stable` to `Understeer`,
  `Oversteer`, or `Four-wheel slide`, `data-testid="state-explanation"`
  updates to name the saturated axle in plain language, and the car's
  position visibly departs from the reference line drawn through the corner.
  Switching `data-testid="drivetrain-*"` changes which axle reaches
  saturation first for the same inputs; switching `data-testid="surface-*"`
  changes how much throttle/steering combination it takes to reach
  saturation at all. Steering at a fixed dry-baseline fraction of full lock
  (see `DRY_BASELINE_STEERING_FRACTION` in `docs/model-assumptions.md`) is
  the reference input that should track the corner's reference line on a dry
  surface from the documented entry speed.
- **Audience**: someone with everyday car-passenger intuition (turning,
  speeding up, braking are all familiar) but no vehicle-dynamics background.
  They do not need to know what a friction circle, slip angle, or bicycle
  model is — the explainer teaches the one idea (shared grip budget) through
  driving, not through the underlying maths, and says plainly that it is a
  simplified teaching model, not professional driving instruction.
- **Explicitly excluded**: multiple tracks or corners; lap timing; other
  traffic or collisions; cockpit view; gear/clutch simulation; ABS/ESC/TC;
  tyre temperature/wear; suspension, differential, or aero tuning; detailed
  dynamic weight transfer (front/rear normal load is fixed and symmetric);
  real vehicle makes or performance claims; downloaded 3D models; a
  long-form tutorial. Full exclusion list and rationale in the top-level
  assignment brief this file narrows.
- **Edge cases that matter**: keyboard-only driving (Arrow keys and WASD,
  Enter/Space for buttons); touch controls sized and reachable on a 390×844
  phone with no hover dependency; resizing from desktop to phone mid-run
  without losing simulation state or throwing console errors; a
  `prefers-reduced-motion` visitor still gets the full instrument-panel
  explanation even with camera motion and easing reduced; a visitor who
  never touches the surface/drivetrain controls, but does press
  `data-testid="start-run"`, still reaches a saturation state within the
  default corner and forgiving first-run configuration; releasing every
  pedal brings the car to and holds it at a true stop rather than coasting
  indefinitely or reversing through zero.

## Model assumptions (must stay visible, not just in code)

The simulation is a deliberately simplified, documented teaching model — see
`docs/model-assumptions.md` and the in-page "About this model" disclosure. It
must never claim FWD always understeers, RWD always oversteers, AWD cannot
slide, or that dry/wet/ice map to one universally correct friction
coefficient — the surface presets are illustrative, relative grip conditions
only.

## Checkable vs judged

Machine-checkable (write a test in `spec/assignment-1.test.ts` or
`e2e/viewport.spec.ts`):
- #1 deploy — already covered by the template's CI `deploy` job, nothing new
  to write here.
- #2 invariants — already covered by `spec/invariants.test.ts`, shipped.
- #3 both viewports — `e2e/viewport.spec.ts` (rewritten for this brief, see
  CLAUDE.md).
- #4 the interaction — `spec/assignment-1.test.ts` (rewritten to assert the
  semantic DOM contract above ships in the built markup) plus
  `e2e/viewport.spec.ts` (asserts the live behaviour: throttle-while-steering
  changes utilisation and, once saturated, the state label).
- #6 files exist / commits cite real SHAs — already covered by
  `scripts/check-evidence.ts`, shipped.

Also machine-checkable, in `src/simulation/*.test.ts` (unit, no DOM/WebGL):
- FWD/RWD/AWD assign drive demand to the documented axle(s).
- A lower-grip surface reduces available combined force.
- Adding longitudinal demand on top of existing lateral demand raises
  combined utilisation.
- Front saturation yields the understeer state; rear saturation yields
  oversteer; both yield four-wheel slide.
- Reset returns to the same deterministic initial state every time.
- The same input sequence produces the same output sequence (no hidden
  randomness).
- Load and Reset leave the car at rest indefinitely; only `startRun` puts it
  in motion (`src/simulation/behaviour.test.ts`).
- Releasing throttle and brake brings the car to, and holds it at, exactly
  zero speed rather than coasting forever or reversing through zero
  (`src/simulation/behaviour.test.ts`).
- Unsaturated dry-baseline steering from the documented entry speed produces
  a bounded path error against the corner's reference line
  (`src/simulation/behaviour.test.ts`).
- Identical scripts on wet/ice reach rear-axle saturation earlier, and show
  more body slip over a sustained run, than the same script on dry
  (`src/simulation/behaviour.test.ts`).

Judged by a person, not a test — know you're still on the hook for these at
the crit:
- #5 whether it really is *one* strong idea, scoped with judgement, not a
  pile of features.
- #4's "plainly enough" — a test passing doesn't mean the interaction is any
  good, only that it does what you said it does.
- #6's commit history actually growing with the work, not reconstructed after
  the fact.
- Whether the 3D chase view and instrument panel actually make saturation
  *legible* — camera behaviour, colour, and motion are judged live in a
  browser at both viewports, not by a green test suite.
