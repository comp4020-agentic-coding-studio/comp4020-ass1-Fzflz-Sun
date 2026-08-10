# COMP4020 prototype

This is your starter repo for a COMP4020 prototype: a static site written in
HTML/CSS/TypeScript that builds to plain HTML/CSS/JS and deploys to GitHub
Pages. The **deployed site is what gets marked** --- not this repo, and not "it
works on my machine". It's marked live in Chrome against the deployed URL at two
viewports --- 1920×1080 (desktop) and 390×844 (phone) --- and both count in
full, so make that artefact good at both and use the checks below to know
whether it is.

What you're building this week — the spec — is published on the course website,
and this repo's name tells you which deliverable it is. Run the course plugin's
**start** skill at the start of each week: it pulls the right spec from the
course API, carries your harness forward from last week, and helps you turn the
spec's checkable lines into tests of your own. Read the spec before you build,
and see `spec/README.md` for how the checks in this repo relate to it.

This deliverable's narrowed brief — the one idea, the one mechanic, the core
interaction stated as a testable sentence — lives in `spec/brief.md`, not just
on the course site. It's expected to change during the week; write it with the
agent, don't just hand it a draft.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Before you push, run `pnpm check`. It runs most of what CI runs --- build,
  lint, and the spec --- so you catch those in seconds instead of waiting for
  the pipeline. The links check, the evidence check, the secrets scan, and the
  deploy itself only run in CI; run `pnpm dlx linkinator ./dist --silent`
  locally against a fresh `pnpm build` for the links check without waiting for
  CI.
- To see what the page actually looks like rather than what you assume it looks
  like, open it in a browser (the `agent-browser` CLI, documented on
  [the course site](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/backpressure/#agent-browser-the-rendered-page-as-ground-truth),
  works well for this). The rendered page is the truth; your mental model of it
  isn't.
- When a check fails, read its output before changing anything. Each check below
  names what it measures, and the failure message is the instruction: it tells
  you the file, the line, or the contract. Treat a red check as authoritative
  --- the page is wrong until the check is green, not until you decide it should
  be.
- Commit when the checks pass. Never commit a red state.
- After touching the core interaction, run `pnpm test:e2e` (Playwright,
  `e2e/viewport.spec.ts`) before pushing. It loads the built site at both
  marking viewports and checks the interaction responds to a click *and* to
  keyboard activation, then checks nothing breaks if the viewport resizes
  mid-interaction. A screenshot or a claim of "it works" isn't evidence; this
  is. It starts red — there's no interaction to find yet — and should turn
  green the same push that implements the real thing. It isn't wired into CI
  (a browser install would slow every push down for a check only the
  interaction-touching commits need); run it locally, deliberately, not as a
  habit for every unrelated change.

## The checks (your sensors)

CI runs these on every push once your repo is public. GitHub's checks UI shows
two jobs, `check` and `deploy` --- not one status per sensor below --- and
within `check` the steps run in sequence (`pnpm check` chains typecheck, build,
lint, and the spec with `&&`), so an early failure like a broken build stops the
later sensors from running for that push; fix it and push again to see the rest.
While the repo is private (all week, until you ship) the CI jobs stay skipped
--- `pnpm check` is the same roster on your machine, and it's the faster loop
anyway. They aren't hoops. Each is a different way of finding out something true
about the site that you can't reliably see by looking at it.

They also carry a mark at a crit: the sweep runs fifteen minutes after your
cutoff, and green checks there are worth half that week's shipped mark. Still
running counts as not green, so ship with time for CI to finish.

- **typecheck** --- `tsc --noEmit` runs first in `pnpm check`, so a type error
  stops the roster before the build even starts. The types are extra
  backpressure: a red here is the compiler telling you a claim in the code is
  false.
- **build** --- the site must build (`pnpm build`). A build failure means the
  deployed site is broken or stale, so nothing else matters until this is green.
- **deploy / online** --- the live GitHub Pages URL must load and return the
  page you expect. An asset that 404s on the deployed URL counts as broken even
  if it loads locally.
- **spec** --- `spec/invariants.test.ts` asserts what's true of any good
  website, whatever the week's brief asks; the tests you write for the week's
  own spec run alongside it (any `spec/*.test.ts`). A failure names the contract
  you haven't met yet.
- **e2e** (`pnpm test:e2e`, `e2e/viewport.spec.ts`) --- real-browser check, not
  CI, not shipped by the template: added this week to test the core interaction
  at both marking viewports, by click and by keyboard, and across a resize
  mid-interaction. Local-only and not part of `pnpm check` on purpose — see
  above.
- **lint** --- `stylelint` for CSS, `oxlint` for TypeScript. Flags code that's
  wrong, fragile, or non-idiomatic. Read the rule it names.
- **tests** --- any other tests you write, wherever you put them (co-located
  with your source is fine, not just `spec/`), must pass. Vitest picks up both
  this and the spec suite in one `vitest run`, the last step of `pnpm check`. A
  failing test is a claim about the site that's no longer true.
- **evidence** (`pnpm check:evidence`) --- checks your process evidence:
  `PROCESS.md`'s citations resolve to real commits, the current deliverable's
  exact reflection is in `reflections/` (worked out from this repo's name
  against the public course API), and your `CLAUDE.md` is present. Evidence
  gates the deploy --- `deploy` needs `check` to pass, so failing evidence
  blocks the deploy alongside everything else. See
  [Your process is part of the mark](#your-process-is-part-of-the-mark) below,
  and the course website's
  [assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
  for what counts as evidence.
- **links** --- internal links must resolve. A broken link is a dead end you
  didn't mean to ship.
- **secrets** --- the repo is scanned for committed credentials. Never put a
  key, token, or password in a tracked file. If one leaks, rotate it. A local
  pre-commit hook (`.githooks/pre-commit`, installed by `pnpm install`) also
  blocks any commit containing something shaped like an API key --- by the time
  CI sees a key it's already pushed, so the hook is the sensor that matters.

Nothing here measures **accessibility** or **performance** --- wiring those
sensors (`axe-core`, Lighthouse, or whatever you choose) is your work, and later
in the course the spec will ask you to show how you tested both. When you do,
read a green performance result honestly: it's a lab estimate from one run on a
CI machine, not proof the site is fast for real users.

## The stack is swappable

Out of the box this is plain HTML/CSS/TypeScript on Vite, and every `.html` file
in the repo is a page: add pages, link them, and the build picks them up with no
config. That's a default, not a rule (unless the week's spec says otherwise).
You can swap in Astro or any other static generator, because nothing in CI names
a tool --- the whole contract is:

- `pnpm build` emits the complete site into `dist/`
- the `package.json` scripts (`check`, `check:evidence`, `build`) keep working
- whatever lands in `dist/` still passes the invariants in `spec/`

Two things bite in a swap. The deployed site lives under a path
(`…github.io/<repo>/`), so configure your generator's base path --- this
template's Vite config uses relative asset URLs to sidestep that, but most
generators (Astro included) need `base` set explicitly, and getting it wrong
looks fine locally while every asset 404s on the live URL. And commit the
updated `pnpm-lock.yaml`: CI installs with `--frozen-lockfile`.

## Your process is part of the mark

The deployed page is only half of it. How you got there is marked too: your
commit history, your agent files, and the decisions visible across them. The
checks above can't see any of that, so a person reads it directly --- which
means building legibly is part of building well.

- **Commit as you go.** Small, frequent commits are the record of how the work
  came together, and that record is read, not just the final state. A trail that
  grew alongside the code is the strongest evidence of your process; a single
  dump the night before is the weakest.
- **Keep a process overview** (`PROCESS.md`). A short reading-guide, not an
  essay: what you built, the moments that mattered --- each pointing at a
  commit, a `CLAUDE.md` change, or a prompt and the commit it produced --- and
  where to look in the history. It points a marker at the evidence; it doesn't
  stand in for it, and claims the history doesn't back don't count. The
  `PROCESS.md` in this repo is a template showing the shape and the citation
  format (link text the commit hash or range, target the commit or compare URL);
  `pnpm check:evidence` verifies your citations resolve to real commits before
  you ship. Markers follow those citations and don't trawl the repo for evidence
  you didn't cite.
- **Write your reflection in `reflections/`** --- a short markdown file in this
  repo, named for the deliverable it answers, so the number in the filename is
  the number in this repo's name (`crit-1.md` in `comp4020-crit1-<you>`,
  `assignment-1.md` in `comp4020-ass1-<you>`); `reflections/README.md` has the
  full rule. `pnpm check:evidence` checks the exact current name against the
  course API, not merely the presence of any well-named file. It answers the two
  standing prompts: the breakthrough that moved the work forward, and what this
  work changed about the developer you want to be. It stays out of the deployed
  site. It's due at the cutoff, and if it isn't in the repo by then the week
  doesn't count as shipped, however good the prototype is.
- **This file is process evidence.** The harness you build to direct the agent,
  this `CLAUDE.md` and any `AGENTS.md`, is itself read as part of how you
  worked. Keep it honest and current (see below).

You don't need a name, a student number, or any identity file in the repo: we
know whose repo it is. Spend the effort on the work.

## This file is yours

This CLAUDE.md is a starting point, not a fixed rulebook. As you learn what your
prototype needs --- a convention to hold the agent to, a sensor that keeps
catching you out, a fact about the stack the agent keeps getting wrong --- write
it down here. Growing this file is the work of harness engineering, and the gap
between this boilerplate and your own version is part of what your prototype
says about the developer you're becoming.

## GRIP IS A BUDGET --- project-specific rules

This prototype's one idea (`spec/brief.md`): every tyre has one finite grip
budget; steering, throttle, and braking all draw on it; drivetrain only
changes which axle carries the longitudinal share. These rules exist to keep
the agent from drifting off that idea or breaking the harness that tests it.

- **`src/simulation/` must not import Three.js, the DOM, or anything from
  `src/rendering/`.** It is the deterministic physics/domain core and must be
  unit-testable under Vitest/jsdom alone. `src/rendering/` and `src/ui/` read
  simulation state; they never own it or mutate it directly.
- **The simulation steps on a fixed timestep and is fully deterministic.**
  Same input sequence in → same output sequence out, every run. No
  `Math.random()`, no wall-clock time, no frame-rate-dependent integration in
  `src/simulation/`. This is what makes the unit tests (FWD/RWD/AWD split,
  saturation → understeer/oversteer, reset) meaningful.
- **Every numeric preset (surface μ, cornering stiffness, drivetrain
  split, brake bias) must be a named, documented constant**, not a magic
  number inline. If you change one, update `docs/model-assumptions.md` in the
  same commit --- the assumptions doc and the code must never disagree.
- **Never encode as fact**: "FWD always understeers", "RWD always
  oversteers", "AWD can't slide", or that dry/wet/ice map to one universally
  correct friction coefficient. The surface presets are illustrative and
  relative; say so in both the UI copy and the docs.
- **Axle colours are fixed and consistent everywhere they appear** (chase
  scene, friction-circle instruments, G-G display, text): front = cool
  cyan/blue, rear = restrained amber, saturation/danger = one coral-red
  accent. Colour is never the only state indicator --- text or shape must
  carry the same information.
- **Renderer and UI changes must not remove semantic DOM state.** The
  `data-testid` contract in `spec/assignment-1.test.ts` (run controls,
  drivetrain/surface/throttle-intensity/throttle-timing pickers, state
  label/explanation, front/rear utilisation, longitudinal/lateral G,
  steering/throttle telemetry) is the non-visual truth of the page; a
  canvas-only representation of any of that state is not acceptable,
  canvas-unavailable or not.
- **No downloaded 3D models, large textures, external font files, or
  Three.js/WebGL.** The car, road, and reference line are drawn with plain
  2D canvas primitives (rects, arcs); type with system/local fonts. Get
  explicit sign-off before adding any binary asset pipeline or 3D rendering
  back.
- **Don't add another vehicle-dynamics concept** (ABS/ESC/TC, tyre
  temperature/wear, suspension, differential, aero, detailed dynamic weight
  transfer, gear/clutch) unless it directly demonstrates the shared-budget
  idea. If a feature request threatens that idea's clarity, defer it and say
  so rather than building it quietly.
- **After any change to the core interaction, simulation constants, or
  layout, check both marking viewports (1920×1080 and 390×844) in a
  real browser, and re-run `pnpm test:e2e` including the resize-mid-run
  case.** Green `pnpm check` proves the DOM contract and the physics unit
  tests; it does not prove the camera, saturation motion, or touch layout are
  legible --- only looking does.
- **The car must never be in motion except as a direct result of the visitor
  pressing Start.** On load and after Reset it sits in an explicit `"ready"`
  phase; `step` must no-op in that phase. This was a real bug: the car used
  to auto-launch on load/reset, and a test that only checks utilisation
  percentages and state labels can't tell "inert" from "already driving"
  apart --- they read identically. If you touch the lifecycle, add a test
  that reads `data-testid="speed"` (or another true motion signal), not just
  the state label.
- **Braking, rolling resistance, and the low-speed lateral-force fade must
  always read the car's actual `vx`/`vy`, never `minSpeedForSlip`** (that
  constant floors only the `atan2` slip-angle denominator). Conflating the
  two once meant the car could coast toward zero but never truly stop.
  Snapping to rest must compare the *sign* of velocity before/after a
  timestep's integration, not just compare against a speed threshold --- a
  large timestep can integrate straight through zero and start reversing
  before a threshold-only check would ever catch it.
- **`maxSteerAngle` is not a standalone tuning knob** --- it must be
  calibrated together with the corner's radius, the car's wheelbase, and
  `ENTRY_SPEED` as one scenario. A steering angle picked in isolation (e.g.
  to look "reasonable" or to avoid overloading the friction circle) can be
  geometrically incapable of matching the corner's own curvature at *any*
  steering fraction, so the car runs wide regardless of input --- a distinct
  failure from a friction-circle overload, and invisible unless you check
  the car can actually track the reference line, not just that it doesn't
  spin.
- **The scene renders through a hand-rolled perspective (pinhole) camera
  over the ground plane — never an orthographic top-down transform
  (`ctx.translate` → `ctx.scale` → `ctx.rotate`) — because a behind-and-above
  chase-camera look is *structurally* impossible with an orthographic
  projection, not merely a matter of tuning.** Two earlier passes rotated the
  orthographic camera to velocity heading and then anchored it low/zoomed in;
  both were implemented correctly and still read as a radar/map view, because
  orthographic projection has no horizon and nothing shrinks with distance —
  no parameter of that transform can produce either. The actual fix is the
  classic Out Run/Pole Position technique: every drawn point's screen
  position is computed numerically via `project()` in
  `src/rendering/projection.ts` (translate → yaw-rotate → pitch-rotate →
  perspective-divide, ground assumed at z=0 everywhere, matching
  `physics.ts`'s flat-ground model), using a real pinhole camera with
  position, yaw, height above the ground, downward pitch, and focal length.
  `horizonScreenY` falls out of that same math (the limit of `project`'s
  `camVert/depth` as distance → ∞) rather than being a second,
  independently-tuned constant — if you change pitch or focal length, the
  horizon and the road's own vanishing point move together automatically. Do
  not reintroduce Three.js/WebGL/true 3D geometry to get this look — the
  camera math is 2D-canvas-drawable numbers, not GPU geometry; see the "no
  downloaded 3D models" rule below, which still applies.
- **Camera yaw tracks the car's current velocity heading (direction of
  travel) directly — never its body heading — and the camera chases from
  behind at a fixed distance/height; slip is now shown by the car sprite
  rotating, not by the frame yawing.** `worldTravelHeading = heading +
  atan2(vy, vx)`; the camera's target position is the car's true position
  offset backward along that heading by `CHASE_DISTANCE_METERS`, and its
  target yaw is `worldTravelHeading` itself (see `src/rendering/scene.ts`'s
  `update()`). This is a deliberate departure from the prior 2D (and the
  original 3D) camera rule, which yawed the *frame* to keep the nose
  vertical: a real chase camera doesn't swing to follow every wiggle of the
  car it's tracking, so a stable, travel-heading-aligned frame is the more
  honest — and more legible — choice once the car itself can carry the
  rotation signal (see the next bullet). The camera's position/yaw still
  ease toward that target with a small, bounded lag (`nextCameraPose`/
  `approach`/`approachAngle` in `src/rendering/camera.ts`, reused completely
  unchanged — only what's fed in as the target changed, not the easing
  itself; time constant 0.05s, ~150ms to within ~5% of a step change), for a
  more cinematic follow. This bound must stay short relative to how long a
  saturation episode plays out. The run-start zoom-settle flourish
  (`RUN_START_ZOOM_FACTOR`) also carries over unchanged. Both must collapse
  to an instant snap when `reducedMotion` is true, the same way `drawTrail`'s
  opacity branch already does.
- **The car is drawn as a screen-space billboard, not projected 3D
  geometry — its chassis is never run through `project()`, only its single
  world anchor point is.** `scene.ts` projects `(state.x, state.y)` through
  the same camera as every other point (so camera lag during a hard slide
  honestly nudges the car's screen position, the same way it would nudge
  anything else the camera is tracking), then draws the sprite locally in a
  fixed template around that anchor, rotated by the **slip angle** —
  `state.heading − worldTravelHeading` — and scaled by the projected point's
  `scale`. Slip angle is zero during normal no-slip driving (the sprite
  points straight up the screen, matching the camera's own travel-heading-
  aligned yaw) and grows the instant an axle saturates and body heading
  diverges from travel direction — this rotation, not a yawing frame, is now
  the core legibility signal for saturation. It depends on `car.ts`'s sprite
  being drawn for a rear-3/4 chase vantage (rear nearest/widest, front
  farthest/narrowest, both axles' wheels visible enough that either's
  saturation colour still reads) rather than a straight-down top view — see
  `src/rendering/car.ts`'s `drawCar()`.
- **Road, kerb, centre-line, and finish-marker geometry are drawn as banded
  quads sampled along the track's arc and projected point-by-point, indexed
  by a world-fixed sample index — never by the sliding draw window's own
  loop index.** `scene.ts`'s `drawRoad()` samples every `ROAD_SAMPLE_STEP_METERS`
  from the track's own fixed `start` angle (`k = floor(progress / dTheta)`,
  where `progress` is measured from that fixed start, not from wherever the
  camera's current bounded draw window happens to begin) and alternates band
  colour by `k % 2`. This is deliberate: a given physical stretch of road
  must always be the same band from one frame to the next, or the pattern
  flickers instead of reading as scrolling toward the camera as the car
  advances — a real bug class in perspective-road rendering (the technique's
  entire "free" motion-cue benefit depends on band identity being stable).
  `ROAD_DRAW_DISTANCE_METERS` is a bounded draw distance calibrated together
  with `TRACK_PRESETS` (constants.ts), same discipline as `maxSteerAngle`: at
  this distance a hairpin's full sweep is deliberately *not* all visible at
  once, the same way a real chase camera never shows a whole corner in one
  frame — don't "fix" that by raising it until the whole corner fits.
- **Driving input is a set of discrete, pre-run settings played back
  deterministically — never real-time steering/throttle held by the
  visitor.** This was a deliberate redesign: real-time input makes visitor
  skill (how well they steer or modulate throttle) a second variable
  entangled with the thing the prototype teaches (the shared per-axle grip
  budget). `controlsAtElapsed(elapsed, throttleIntensity, throttleTiming,
  params, track)` is a pure, closed-form function of elapsed time and the
  five settings — steering always ramps toward the *selected track's own*
  fixed autosteer target, never a visitor input. Reopening real-time driving
  input requires deliberately revisiting this confound, not just wiring up
  held buttons again.
- **Throttle-timing thresholds (`THROTTLE_TIMING_PRESETS`) are not a
  standalone tuning knob** --- same discipline as `maxSteerAngle`. They must
  be calibrated together with every `TRACK_PRESETS` entry's
  `expectedTraversalSeconds`, `ENTRY_SPEED`, and `throttleRampPerSecond` as
  one scenario: the latest threshold needs enough runway before even the
  shortest track ends for its saturation contrast against the earliest
  threshold to actually appear, and every track's own length must stay short
  enough to be a legible, watchable single playback.
- **Every `TRACK_PRESETS` entry is a calibrated bundle, not independently
  tunable fields** --- same discipline as `maxSteerAngle`. A track's
  `radius`, `sweepAngle`, `autosteerFraction`, and `expectedTraversalSeconds`
  must be derived together (`autosteerFraction = atan(wheelbase / radius) /
  maxSteerAngle`, `expectedTraversalSeconds` from `sweepAngle` and
  `ENTRY_SPEED`), and must be documented in `docs/model-assumptions.md` the
  same way. `"left"`/`"right"` variants of the same sharpness must be exact
  mirror images produced by the shared `direction` sign flip in `track.ts`
  (`trackCentre`, `referenceCurvature`, `sweptAngleRate`) --- never a second,
  separately-tuned set of physics constants. A run's `Finished` state is
  reached positionally, when `SimState.sweptAngle` reaches the selected
  track's `sweepAngle` (`shouldFinish` in `physics.ts`), backed by a generous
  `SAFETY_CAP_SECONDS` duration cap so a pathological settings combination
  can't leave a run stuck in `"running"` forever --- the cap is a safety net,
  not the primary finish trigger, and must stay comfortably above every
  preset's `expectedTraversalSeconds`.
- **Historical pointer-capture lesson (kept for any future pointer-based
  interaction, even though `HeldControls`/pointer-capture code no longer
  exists in this repo):** a held pointer control must track *why* it's held
  (a set of source tags), consume a one-shot "pending pulse" flag so a tap
  shorter than one simulation step still registers, and wrap
  `setPointerCapture`/`releasePointerCapture` in try/catch --- both calls
  throw for a pointerId the browser has no active-pointer record for, true
  of any synthetically dispatched `PointerEvent` (Playwright's
  `dispatchEvent`, or an assistive tool), and an uncaught throw aborts the
  handler before the press is ever registered, silently dropping it. This
  was caught by `e2e/viewport.spec.ts`, not by any unit test, because jsdom
  never exercises real pointer capture. If a future iteration reintroduces
  any held/pointer-driven control, re-apply this lesson rather than
  rediscovering it.
