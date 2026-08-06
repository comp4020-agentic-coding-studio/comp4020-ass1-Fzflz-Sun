# Process overview

<!-- WORKING DRAFT: replace COMMIT_A and COMMIT_B with real hashes after the
baseline and handling-fix commits exist. Remove this comment before submission. -->

## What I built

*Grip is a Budget* is a one-corner interactive driving explainer. The visitor
steers, accelerates and brakes while front- and rear-axle meters expose one
idea: cornering, acceleration and braking all spend the same finite tyre-force
budget, and drivetrain changes which tyres spend its longitudinal share. A
chase view connects those measurements to the car's motion. The artefact is
deliberately a controlled teaching experiment rather than a complete racing
game or a claim of engineering-grade vehicle simulation.

## The moments that mattered

### 1. Reducing a driving simulator to one testable claim

My first concept included drivetrain, road surface, G forces, loss of control
and a broad explanation of driving technique. That could easily have become a
collection of controls without a coherent lesson. I narrowed the work to one
repeatable corner and made shared tyre capacity the organising claim. FWD,
RWD, AWD and surface grip became controlled variations of that same experiment,
not separate features. I recorded the boundary in `spec/brief.md`, separated a
deterministic simulation from Three.js rendering, and added project-specific
constraints to `CLAUDE.md`.

> “This is not merely a visual demo and not a full racing game. The interaction
> itself must explain one strong idea: every tyre has one finite grip budget.”



### 2. When green tests contradicted the browser

The initial suite passed both `pnpm check` and all 17 Playwright cases at the
desktop and phone marking viewports. A real drive still exposed three failures:
an irrelevant Home row occupied the header, load and reset launched the car
without input, and a fully gripped car barely followed steering. Reading the
motion code showed why. Reset restored 15 m/s with no rolling resistance; the
brake switched off below 3 m/s; and a 2.6 m wheelbase following a 45 m bend
needed about 0.058 rad of steering while the model allowed only 0.045 rad. The
tests watched utilisation meters and state labels, so they could be green while
the trajectory was wrong. This diagnosis, rather than another round of blind
parameter tweaking, defines the next correction.



### 3. Turning a hand-feel failure into backpressure

The correction is not complete yet. Before claiming that it is, I will add
motion-level acceptance tests: load and reset must remain at rest; braking must
reach zero without reversing; unsaturated steering must produce the requested
heading and a bounded path error; and identical scripts must expose meaningful
FWD, RWD and AWD outcomes rather than merely different percentages. The durable
rules will also go into `CLAUDE.md`, including the geometric relationship
between track radius and steering authority and a camera that preserves the
visible angle between body heading and travel direction. I will then repeat the
two viewport checks and perform a real browser drive before accepting the fix.

