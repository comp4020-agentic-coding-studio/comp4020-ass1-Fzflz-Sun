# Process overview

## What I built

*Grip is a Budget* is a controlled one-corner experiment explaining that a
tyre has one finite force budget shared by all tyre forces; this interaction
focuses on cornering and acceleration. Visitors choose drivetrain, surface,
throttle intensity, throttle timing and track, then run the same scripted
manoeuvre. A rear-chase scene, front/rear utilisation meters and plain-language
outcomes make it possible to compare which axle spends its budget first
without making the visitor's own driving skill an extra variable.

## The moments that mattered

### 1. One claim, not a catalogue of car facts

My first scope treated drivetrain, surfaces, G-force and sliding as separate
features. The obvious implementation was a dashboard of unrelated controls.
Instead, I made shared tyre capacity the single mechanic and separated the
deterministic simulation from its renderer, so every setting became a
controlled variation of one claim. I accepted the first vertical slice only
after physics tests produced the intended front/rear saturation ordering and
the same state remained legible through semantic DOM instruments at both
marking viewports. That boundary was also recorded in the brief and harness so
later visual work could not silently change the experiment.

[`b7e980c`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/b7e980c7bfad52f541c41e7729bff7695fcc0f05)

### 2. A green suite was not evidence that the car felt right

The first playable build passed its checks, but browser use exposed three
motion failures: it launched at 15 m/s, braking stopped applying below the
slip-angle floor, and maximum steering was geometrically insufficient for the
45 m corner. Rather than tune constants until the animation looked plausible,
I wrote failing behaviour tests for rest, brake-to-zero, baseline curvature,
path offset and body slip. I then fixed the lifecycle and physics and added the
motion-level checks and calibration rules to `CLAUDE.md`. The old implementation
failed those tests for the diagnosed reasons; the corrected one passed them,
and I re-ran the experiment manually at desktop and phone sizes.

[`b7e980c...5d482e5`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/compare/b7e980c7bfad52f541c41e7729bff7695fcc0f05...5d482e583c839814ba10e9e4e5f4207ea6ca8dfa)

### 3. Removing driving skill from the experiment

Once manual steering and throttle worked, they revealed a design flaw rather
than a software bug: two visitors could choose identical settings and see
different outcomes because their timing differed. Instead of adding tutorials
or assists, I removed held driving controls and made both steering and throttle
a deterministic `controlsAtElapsed` script driven by five pre-run choices.
Tests were rewritten against that contract before the UI changed. Repeating
the same configuration then produced identical telemetry, while changing one
setting changed the measured saturation timing and path; Playwright also
verified the select-then-Run flow at both viewports. The no-real-time-input rule
was retained in the harness to prevent the confound returning.

[`201cd58`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/commit/201cd5872372625f4d8cb8e0206b2d3c4481b95a)

### 4. Changing the rendering substrate, not polishing the billboard

The pinhole Canvas pass made distance shrink correctly, but the car was still
a screen-space billboard and the scene had no vertical parallax cues. The
obvious response was another round of drawing detail and camera tuning.
Instead, I reversed my earlier no-WebGL rule and replaced only the rendering
layer with Three.js, keeping the deterministic simulation and semantic DOM
untouched. I selected a small CC0 Kenney subset rather than importing whole
packs, inspected the sedan scene graph to confirm its wheel nodes and forward
axis, and recorded every retained asset and licence. Existing simulation and
viewport tests remaining green showed that the experiment contract had
survived the replacement; browser review then confirmed that a real chassis
could make body heading diverge visibly from travel direction. I treated this
as a rendering-foundation correction rather than claiming the visual polish
was finished.

[`266590e...20b1d94`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Fzflz-Sun/compare/266590e7df72facbc61727ed23b325ad45710a23...20b1d9407dbda97602d5d4a1984ab6ac47e52229)
