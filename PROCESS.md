# Process overview

## What I built

*Grip is a Budget* is a one-corner interactive driving explainer. The visitor
steers, accelerates and brakes while front- and rear-axle meters expose one
idea: cornering, acceleration and braking all spend the same finite tyre-force
budget, and drivetrain only changes which axle spends its longitudinal share.
A chase-camera scene connects those numbers to the car's actual motion. It is
a deliberately controlled teaching experiment, not a racing game or a claim of
engineering-grade vehicle simulation — the car sits inert until the visitor
presses Start, brakes to a genuine stop, and never moves except in direct
response to a control.

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
