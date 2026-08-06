# Process overview

## What I built

*Grip is a Budget* is a one-corner driving explainer built as a controlled
experiment, not a driving game. The visitor chooses four discrete pre-run
settings — drivetrain (FWD/RWD/AWD), surface (dry/wet/ice), throttle
intensity (Light/Medium/Full), and throttle timing (Early/Mid/Late) — then
presses Run and watches a fixed-duration, fully deterministic playback on a
top-down 2D stage. Steering is always the same fixed autosteer program, never
a visitor input, so the only variables are the ones the settings name.
Front- and rear-axle meters expose the same idea throughout: cornering and
acceleration draw on one finite tyre-force budget, and drivetrain and
throttle timing only change which axle spends it first. The car sits inert
until Run is pressed, settles into an explicit `Finished` state at the end of
each run, and a fresh Run from `Finished` (no forced Reset) is how a visitor
compares one setting change against the last result.

## The moments that mattered

### 1. Reducing a driving simulator to one testable claim

My first concept treated drivetrain, road surface, G-forces and loss of
control as separate features, which could easily have produced a pile of
controls with no single lesson. I narrowed the brief to one repeatable corner
with shared tyre capacity as the organising claim, so FWD/RWD/AWD and surface
grip became controlled variations of one experiment rather than independent
additions. I split a deterministic simulation from the Three.js renderer
before writing any UI, and recorded the boundary in `spec/brief.md` and
`CLAUDE.md` so later changes would be held to it.

[`b7e980c`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/b7e980c7bfad52f541c41e7729bff7695fcc0f05)

### 2. Green tests that disagreed with the browser

That commit passed `pnpm check` (57/57) and all 17 Playwright cases at both
marking viewports. Driving it in a real browser told a different story: the
car launched itself the instant the page loaded, braking never actually
stopped it, and full steering barely turned the car through the corner.
Reading the physics explained why, rather than guessing at constants:
`createInitialState` restored 15 m/s with no rolling resistance, brake force
cut out below `minSpeedForSlip`, and a 2.6 m wheelbase following a 45 m corner
geometrically needs about 0.058 rad of lock while `maxSteerAngle` allowed only
0.045 rad — the car couldn't have tracked the line at any steering input, gripped
or not. The suite only ever read utilisation percentages and state labels, so
none of this was visible to it, and a leftover "Home" self-link sat in the
header doing nothing for the brief either.

### 3. Writing the red tests before touching the fix

Before changing any physics, I added `src/simulation/behaviour.test.ts`
against the *existing* implementation, asserting motion rather than labels:
the car stays exactly put through load and Reset, braking reaches and holds
zero without reversing, steering while stationary produces no yaw, a named
dry-baseline steering input tracks the reference line, and FWD/RWD/AWD and
surface differences show up as measured curvature, path offset and body slip
— not just percentages. Those failed for exactly the reasons diagnosed in (2).
Only then did I add the `ready`/`running` lifecycle gated behind a Start
control, fix braking and the low-speed force fade to read the car's actual
`vx`/`vy` instead of the slip-angle floor, recalibrate steering angle against
the corner's own geometry, repoint the chase camera at velocity heading
instead of body heading so slip is visible instead of hidden by the camera
following it, and removed the dead header link while keeping the `<nav>`
landmark the starter invariants require. The corrections that generalise are
now rules in `CLAUDE.md` — lifecycle, braking-vs-`minSpeedForSlip`,
steering/geometry calibration as one scenario, camera-tracks-travel-direction,
pointer-capture `try`/`catch` — not just fixed constants. `pnpm check` is now
75/75 and `pnpm test:e2e` is 21/21 across both viewports, including the
resize-mid-run case, and I re-drove both viewports by hand before accepting
the fix rather than trusting the green run alone.

[`5d482e5`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/5d482e583c839814ba10e9e4e5f4207ea6ca8dfa)

### 4. The green, working build was still the wrong interaction

Fixing (2) and (3) made the drive feel correct, but re-reading the brief's
own rubric — one strong idea, an interaction simple enough to reason about —
against what I'd actually built exposed a different problem, not a bug:
holding steering and throttle in real time let the visitor's own driving
skill become a second variable entangled with the one thing the prototype
teaches. It could never produce the kind of clean, attributable conclusion
this course's own Elevators and trolley-problem examples get from a single
discrete choice. I converted the interaction to a controlled experiment: the
visitor sets drivetrain, surface, throttle intensity, and throttle timing,
then presses Run once, and a closed-form `controlsAtElapsed(elapsed, ...)`
plays back the identical script every time for those settings — steering was
already a fixed autosteer target from the prior fix, so this mainly meant
retiring the last real-time input (held throttle) and its whole
`HeldControls`/pointer-capture machinery in `src/ui/controls.ts`, which had
no reason to exist once nothing is held anymore. I also swapped the 3D
chase-camera scene for a translate-only, north-up 2D top-down view: besides
being a more tractable rendering surface than modelling a convincing 3D car,
a fixed-orientation camera makes slip legible by construction, whereas the
old chase camera needed an explicit rule (track velocity heading, not body
heading) to avoid hiding it. Wheels still switch to the coral saturation
accent the moment an axle's `utilisation` exceeds 1, so that signal survived
the change unchanged.

As with (3), I rewrote `src/simulation/behaviour.test.ts` and
`e2e/viewport.spec.ts` against the new contract before implementing —
replacing hand-built `HeldControls`-shaped inputs with settings-driven
`controlsAtElapsed` calls, and replacing keyboard-hold/pointer-hold assertions
with select-a-setting-then-press-Run assertions — and confirmed they failed
against the old real-time-driving code for the expected reason before
changing `main.ts`, `src/rendering/`, and `src/simulation/inputs.ts`. The
generalising rules — driving input is discrete and deterministic, never
real-time again without deliberately revisiting that confound; the 2D camera
must stay translate-only and north-up; throttle-timing thresholds are
calibrated together with `RUN_DURATION_SECONDS`, `ENTRY_SPEED`, and
`throttleRampPerSecond` as one scenario, the same discipline as
`maxSteerAngle` — are now in `CLAUDE.md`, alongside the pointer-capture lesson
from (3) kept as a note for any future held/pointer control, even though the
code it was fixing no longer exists. `pnpm check` is now 79/79 and
`pnpm test:e2e` is 25/25 across both viewports, including the resize-mid-run
case; removing Three.js also dropped the production JS bundle from a
>500 kB warning to 11.66 kB, and I re-drove both viewports by hand — set
identical settings but Early vs. Late throttle timing — to confirm the
saturation-timing contrast the redesign exists to make legible was actually
visible, not just asserted by a test.

[`201cd58`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/201cd5872372625f4d8cb8e0206b2d3c4481b95a)
