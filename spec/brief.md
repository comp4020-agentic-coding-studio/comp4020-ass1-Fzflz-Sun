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
- **The mechanic**: one car, one of four selectable fixed corners, driven by a
  single deterministic autosteer + throttle script the visitor configures
  *before* it runs, not by real-time driving input. Steering is always the
  same fixed autosteer program calibrated to whichever corner is selected (so
  it is never a second variable to control for); the visitor's only inputs
  are five discrete pre-run settings — drivetrain (FWD/RWD/AWD), surface
  (dry/wet/ice), throttle intensity (Light/Medium/Full), throttle timing
  (Early/Mid/Late, i.e. how soon into the run throttle starts ramping in),
  and track (Sweep left/right, Hairpin left/right) — plus one
  `data-testid="start-run"` button. Steering and throttle demand are combined
  per axle through a friction-circle limit
  (`utilisation = sqrt((Fx/FxLimit)^2 + (Fy/FyLimit)^2)`), and the drivetrain
  choice only changes *which axle* carries the longitudinal share. When
  utilisation on an axle exceeds 1, that axle's achievable force clamps, and
  the car visibly runs wide (front saturates) or rotates (rear saturates).
  Throttle timing is one piece that makes the shared-budget idea legible
  without any real-time skill: lateral demand from cornering is highest right
  after corner entry and eases as the car coasts, so applying the same
  throttle intensity *early* stacks on that peak lateral demand and saturates
  an axle sooner than applying it *late* — a controlled comparison a visitor
  makes by changing one setting and pressing Run again, exactly like the
  course's Elevators/trolley-problem examples. Track choice is a second,
  independent demonstration of the same idea: a tighter corner (the hairpin)
  demands more lateral force at the same speed than a gentle sweep, so it
  saturates an axle sooner under otherwise-identical settings — no new
  physics, just a smaller radius to hold. Left/right of the same sharpness
  are exact mirror images (same corner, opposite hand), reusing the model's
  existing left/right symmetry rather than any separately-tuned physics.
- **The core interaction, stated testably**: the car sits at rest
  indefinitely on load or after `data-testid="reset"` — nothing moves until
  the visitor presses `data-testid="start-run"`, which enters the selected
  corner at a documented entry speed and plays back a fully deterministic run
  using whatever `data-testid="drivetrain-*"`, `data-testid="surface-*"`,
  `data-testid="throttle-intensity-*"`, `data-testid="throttle-timing-*"`,
  and `data-testid="track-*"` are currently selected. Over that run,
  `data-testid="front-utilisation"` and/or `data-testid="rear-utilisation"`
  rise in the instrument panel, and `data-testid="speed"` and
  `data-testid="path-offset"` show the car actually moving and departing from
  the reference line, not just the percentages changing; once combined
  demand exceeds 100% on an axle, `data-testid="state-label"`'s text changes
  from `Stable` to `Understeer`, `Oversteer`, or `Four-wheel slide`, and
  `data-testid="state-explanation"` updates to name the saturated axle in
  plain language. Every track has an explicit, finite length (a swept arc
  angle, not an open-ended corner), calibrated so the documented entry speed
  brings the car to the *end* of that arc at or near `Finished` — the run
  ends positionally, once the car has actually travelled the selected
  track's length (`shouldFinish`, backed by a generous safety-cap duration so
  a pathological settings combination can't run forever), holding the car's
  settled final state. Pressing `data-testid="start-run"` again from
  `Finished` — with no forced Reset in between — starts a fresh, independent
  run from the current settings, which is how a visitor compares one setting
  change against the last run. The five setting pickers are disabled only
  while a run is actually in progress, and re-enabled the moment it reaches
  `Finished`. Switching `data-testid="drivetrain-*"` changes which axle
  reaches saturation first for an identical script; switching
  `data-testid="surface-*"` changes how much throttle it takes to reach
  saturation at all; switching `data-testid="throttle-timing-*"` with every
  other setting held fixed changes *when* (or whether) saturation happens
  within the run; switching `data-testid="track-*"` to a tighter corner
  (hairpin vs. sweep) with every other setting held fixed reaches saturation
  at a lower throttle intensity, or earlier in the run, because the tighter
  corner alone demands more lateral force at the same speed. The fixed
  autosteer target for each track (calibrated from that track's own radius —
  see `TRACK_PRESETS` in `docs/model-assumptions.md`) is calibrated to track
  that corner's reference line on a dry surface from the documented entry
  speed.
- **Audience**: someone with everyday car-passenger intuition (turning,
  speeding up, braking are all familiar) but no vehicle-dynamics background.
  They do not need to know what a friction circle, slip angle, or bicycle
  model is — the explainer teaches the one idea (shared grip budget) through
  driving, not through the underlying maths, and says plainly that it is a
  simplified teaching model, not professional driving instruction.
- **Explicitly excluded**: a run-history or compare-across-runs UI; lap
  timing; other traffic or collisions; cockpit view; gear/clutch simulation;
  ABS/ESC/TC; tyre temperature/wear; suspension, differential, or aero
  tuning; detailed dynamic weight transfer (front/rear normal load is fixed
  and symmetric); real vehicle makes or performance claims; downloaded 3D
  models; a long-form tutorial. (Multiple tracks/corners is *not* excluded —
  four fixed presets exist, chosen from a picker before a run, same as the
  other settings; there is no free-form track editor or arbitrary corner
  geometry.) Full exclusion list and rationale in the top-level assignment
  brief this file narrows.
- **Edge cases that matter**: keyboard-only operation (Tab between setting
  pickers and the Run/Reset buttons, Enter/Space to activate them — there is
  no continuous arrow-key driving to support anymore); touch targets sized
  and reachable on a 390×844 phone with no hover dependency; resizing from
  desktop to phone mid-run without losing simulation state or throwing
  console errors; a `prefers-reduced-motion` visitor still gets the full
  instrument-panel explanation even with camera motion and easing reduced;
  a visitor who never touches the drivetrain/surface/throttle pickers, but
  does press `data-testid="start-run"`, still reaches a saturation state
  within the default corner and forgiving first-run configuration; pressing
  `data-testid="start-run"` again from `Finished` (no forced Reset) starts a
  clean independent run rather than continuing or accumulating state from
  the previous one; setting pickers stay disabled for the whole of a run in
  progress and re-enable the instant it reaches `Finished`, so a visitor
  can't change a setting mid-run and get a result that mixes two
  configurations.

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
  `e2e/viewport.spec.ts` (asserts the live behaviour: selecting settings and
  pressing `start-run` drives real motion and rising utilisation, saturation
  flips the state label, the run settles into `Finished`, and re-pressing
  `start-run` from `Finished` without a Reset in between starts a fresh,
  independent run under the current settings).
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
- Whether the 2D bird's-eye scene and instrument panel actually make
  saturation *legible* — camera behaviour (it rotates to track velocity
  heading so a saturated axle's slip visibly shows against a stable frame),
  colour, and motion are judged live in a browser at both viewports, not by
  a green test suite.
