# Process overview

## What I built

*Grip is a Budget* is a scrolling explorable about one claim: a tyre has one
finite force budget shared by cornering and acceleration. After a scripted
intro, five independent experiments reveal corner, surface, throttle,
drivetrain and timing one variable at a time; a final sandbox combines them.
Deterministic runs, a 3D rear-chase scene, axle-utilisation meters and measured
outcomes let visitors compare which axle spends its budget first without
making driving skill another variable.

## The moments that mattered

### 1. One claim, not a catalogue of car facts

My first scope treated drivetrain, surfaces, G-force and sliding as separate
features. The obvious implementation was a dashboard of unrelated controls.
Instead, I made shared tyre capacity the single mechanic and separated the
deterministic simulation from its renderer, so every setting became a
controlled variation of one claim. I accepted the vertical slice only after
physics tests produced the intended front/rear saturation ordering and the
same state remained legible through semantic DOM instruments at both marking
viewports. I recorded that boundary in the brief and harness so later visual
work could not silently change the experiment.

[`b7e980c`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/b7e980c7bfad52f541c41e7729bff7695fcc0f05)

### 2. A green suite was not evidence that the car felt right

The first playable build passed its checks, but browser use exposed three
motion failures: it launched at 15 m/s, braking stopped below the slip-angle
floor, and maximum steering could not geometrically follow the 45 m corner.
Rather than tune constants until the animation looked plausible, I wrote
failing tests for rest, brake-to-zero, curvature, path offset and body slip.
The old implementation failed for the diagnosed reasons; after fixing it, the
tests passed and manual runs at desktop and phone sizes behaved consistently.
I retained those motion-level checks and calibration rules in `CLAUDE.md`.

[`b7e980c...5d482e5`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/compare/b7e980c7bfad52f541c41e7729bff7695fcc0f05...5d482e583c839814ba10e9e4e5f4207ea6ca8dfa)

### 3. Removing skill and interface knowledge as confounds

Manual steering first showed that identical settings could produce different
results because visitors drove differently, so I replaced held inputs with a
deterministic script. The resulting dashboard was repeatable, but it exposed
all five variables before explaining any of them. Instead of adding more
instructions, I later restructured it as five ordered, one-variable modules
followed by a sandbox. Each module owns its state and scene, pauses offscreen,
and derives its conclusion from the completed run rather than canned copy.
Harness checks were rewritten around that structure; 188 unit/spec checks and
73 Playwright cases then passed across both viewports. Durable rules now guard
both deterministic input and progressive disclosure.

[`201cd58`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/201cd5872372625f4d8cb8e0206b2d3c4481b95a), [`4a328fc`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/4a328fc6e7506163a6b9063827dae3e8222adbb4)

### 4. Changing the rendering substrate, not polishing the billboard

The pinhole Canvas pass made distance shrink correctly, but the car was still
a screen-space billboard and the scene had no vertical parallax cues. The
obvious response was another round of drawing detail and camera tuning.
Instead, I reversed my earlier no-WebGL rule and replaced only the rendering
layer with Three.js, keeping the deterministic simulation and semantic DOM
untouched. I selected a small CC0 Kenney subset, inspected its scene graphs,
and recorded each licence. When props appeared at arbitrary sizes and angles,
I did not add more magic scale numbers: shared fitting code measured bounding
boxes against explicit real-world dimensions and local forward axes. Pure
placement tests, the existing simulation suite and browser review verified
that the new scene improved depth without changing experimental outcomes.

[`266590e...20b1d94`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/compare/266590e5c9327156bfe54ecaef4ede198df739d6...20b1d9407dbda97602d5d4a1984ab6ac47e52229), [`c029171`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/c029171881ecfbb5af8e271ab55c3ac377722f82)
