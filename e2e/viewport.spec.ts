import { expect, test } from "@playwright/test";

// Turns assessment spec line #3 ("works at both marking viewports") and
// spec/brief.md's "core interaction, stated testably" into real-browser
// checks. Runs against the built site via playwright.config.ts's webServer.
//
// The interaction is a discrete pre-run experiment, not real-time driving:
// the visitor picks drivetrain/surface/throttle-intensity/throttle-timing/
// track, presses Run, and watches a deterministic playback settle into a
// "finished" state once the car reaches the end of its selected track's
// finite swept arc (position-based, see shouldFinish in physics.ts) — not a
// fixed wall-clock duration. Changing one setting and pressing Run again —
// without a forced Reset in between — is the whole comparison mechanic this
// file exercises.
const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "phone", width: 390, height: 844 },
] as const;

// Generous upper bound on how long any run can take before "Finished" — must
// match src/simulation/constants.ts's SAFETY_CAP_SECONDS, the backstop that
// bounds even a pathologically slow, non-saturating run. Real runs finish
// well under this (the longest preset, hairpin, is a ~8.7s estimate).
const SAFETY_CAP_MS = 20_000;
const FINISH_TIMEOUT_MS = SAFETY_CAP_MS + 3000;

async function readNumber(page: import("@playwright/test").Page, testid: string): Promise<number> {
  const text = await page.getByTestId(testid).textContent();
  const n = Number.parseFloat((text ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

async function runToFinish(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("state-label")).toContainText("Finished", {
    timeout: FINISH_TIMEOUT_MS,
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("loads with no console errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await page.goto("/");
      expect(errors, `console errors on ${viewport.name}: ${errors.join("; ")}`).toEqual([]);
    });

    test("has no horizontal overflow", async ({ page }) => {
      await page.goto("/");
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(
        scrollWidth,
        `page is ${scrollWidth}px wide on a ${viewport.width}px viewport — something overflows`,
      ).toBeLessThanOrEqual(viewport.width);
    });

    test("the sticky quick-reference bar expands once the key-info group scrolls out of .sidebar's view", async ({
      page,
    }) => {
      await page.goto("/");
      await page.getByTestId("reset").click();

      const controlBar = page.getByTestId("control-bar");
      await expect(
        controlBar,
        "the bar must start collapsed — the key-info group is fully visible before any scrolling",
      ).toHaveAttribute("data-expanded", "false");

      // How much room .sidebar actually has to scroll: this is real,
      // viewport-dependent geometry, not a per-viewport branch we chose —
      // at 390x844 the six sidebar sections overflow .sidebar's height, so
      // scrolling genuinely pushes the key-info group out of view; at
      // 1920x1080 they currently all fit without scrolling, so the group
      // never leaves view and the bar correctly never expands there. Both
      // are the same IntersectionObserver/CSS exercising real behaviour —
      // this just asserts whichever outcome that behaviour actually produces
      // at this viewport, instead of assuming a scroll distance that may not
      // exist.
      const canScroll = await page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar");
        return sidebar !== null && sidebar.scrollHeight > sidebar.clientHeight;
      });

      await page.evaluate(() => document.querySelector(".sidebar")?.scrollTo({ top: 999999 }));

      if (canScroll) {
        await expect(
          controlBar,
          "scrolling the key-info group out of view must expand the sticky bar",
        ).toHaveAttribute("data-expanded", "true");
        await expect(page.getByTestId("sticky-state-label")).toBeVisible();
        await expect(page.getByTestId("sticky-speed")).toBeVisible();

        await page.evaluate(() => document.querySelector(".sidebar")?.scrollTo({ top: 0 }));
        await expect(
          controlBar,
          "scrolling the key-info group back into view must collapse the sticky bar again",
        ).toHaveAttribute("data-expanded", "false");
      } else {
        await expect(
          controlBar,
          "with nothing to scroll past, the bar must stay collapsed",
        ).toHaveAttribute("data-expanded", "false");
      }

      // Run and Reset never move out of the always-visible control bar,
      // regardless of expanded state.
      await expect(page.getByTestId("start-run")).toBeVisible();
      await expect(page.getByTestId("reset")).toBeVisible();
    });

    test("renders the 3D stage visibly on first load, before Run is ever pressed", async ({ page }) => {
      // main.ts's render loop calls scene.update() every frame regardless of
      // run phase, so the chase-cam stage (car/track/environment) is meant to
      // be visible immediately on load, not only once a run starts — this
      // asserts that real, working behaviour rather than assuming it from the
      // absence of a console error.
      await page.goto("/");
      const canvas = page.getByTestId("scene-canvas");
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      expect(box, "scene canvas must have a real, measurable box on first paint").not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    });

    test("the car sits at rest until Run is pressed, even while changing settings", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("reset").click();
      await expect(page.getByTestId("state-label")).toHaveText("Ready");
      expect(await readNumber(page, "speed"), "the car must be at rest before Run is pressed").toBe(0);

      // Settings are pre-run choices now, not live controls — picking one
      // before Run must not move the car.
      await page.getByTestId("surface-wet").click();
      await page.getByTestId("throttle-intensity-full").click();
      await expect(
        page.getByTestId("state-label"),
        "changing settings before Run must not leave the Ready phase",
      ).toHaveText("Ready");
      expect(await readNumber(page, "speed"), "the car must still be at rest").toBe(0);

      await page.getByTestId("start-run").click();
      await expect(
        page.getByTestId("state-label"),
        "Run should leave the Ready phase for a real driving state",
      ).not.toHaveText("Ready");
      expect(
        await readNumber(page, "speed"),
        "Run should put the car in motion at the documented entry speed",
      ).toBeGreaterThan(5);
    });

    test("a full run drives real motion and settles into a finished state", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      await page.getByTestId("reset").click();
      const offsetBefore = await readNumber(page, "path-offset");

      await runToFinish(page);

      const speedAfter = await readNumber(page, "speed");
      const offsetAfter = await readNumber(page, "path-offset");
      expect(speedAfter, "speed should read real, non-zero motion after a run").toBeGreaterThan(1);
      expect(
        Math.abs(offsetAfter - offsetBefore),
        "the autosteer program should move the car off the reference line over a full run",
      ).toBeGreaterThan(0.05);
    });

    test("throttle telemetry stays at 0% before the selected timing threshold, then reaches full", async ({
      page,
    }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      await page.getByTestId("throttle-intensity-full").click();
      await page.getByTestId("throttle-timing-late").click(); // 4.5s threshold
      await page.getByTestId("reset").click();

      await page.getByTestId("start-run").click();
      await page.waitForTimeout(1000); // well before the 4.5s "late" threshold
      expect(
        await readNumber(page, "throttle-value"),
        "throttle telemetry must read exactly 0% before the timing threshold is reached",
      ).toBe(0);

      await expect(page.getByTestId("state-label")).toContainText("Finished", {
        timeout: FINISH_TIMEOUT_MS,
      });
      expect(
        await readNumber(page, "throttle-value"),
        "by the end of the run, throttle should have ramped up past the timing threshold",
      ).toBeGreaterThan(50);
    });

    test("throttle telemetry ramps toward the selected intensity, not always to full", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      await page.getByTestId("throttle-intensity-light").click();
      await page.getByTestId("throttle-timing-early").click();
      await page.getByTestId("reset").click();

      await page.getByTestId("start-run").click();
      await page.waitForTimeout(1500); // past light's ~0.33s ramp-in time
      const lightThrottle = await readNumber(page, "throttle-value");
      expect(lightThrottle, "light intensity should settle near its 40% fraction, not 100%").toBeLessThan(60);
      expect(lightThrottle).toBeGreaterThan(20);
    });

    // Sampled ~3s into the run (not at "finished") on purpose: by the full 6s
    // duration a sustained full-throttle+early script has usually pushed the
    // car into a hard multi-second slide at very high speed, where utilisation
    // readings balloon well past 100% for every drivetrain alike and stop
    // ordering cleanly — the same 2-4s window src/simulation/behaviour.test.ts
    // section D samples at, before that regime, is what actually shows the
    // drivetrain/surface contrast.
    const MID_RUN_SAMPLE_MS = 3000;

    test("selecting RWD changes which axle saturates most, versus FWD", async ({ page }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 8000);
      await page.goto("/");
      await page.getByTestId("throttle-intensity-full").click();
      await page.getByTestId("throttle-timing-early").click();

      await page.getByTestId("drivetrain-fwd").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("start-run").click();
      await page.waitForTimeout(MID_RUN_SAMPLE_MS);
      const fwdFront = await readNumber(page, "front-utilisation");
      const fwdRear = await readNumber(page, "rear-utilisation");
      await page.getByTestId("reset").click();

      await page.getByTestId("drivetrain-rwd").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("start-run").click();
      await page.waitForTimeout(MID_RUN_SAMPLE_MS);
      const rwdFront = await readNumber(page, "front-utilisation");
      const rwdRear = await readNumber(page, "rear-utilisation");

      expect(fwdFront, "FWD should load the front axle more than RWD does").toBeGreaterThan(rwdFront);
      expect(rwdRear, "RWD should load the rear axle more than FWD does").toBeGreaterThan(fwdRear);
    });

    test("selecting the low-grip surface raises utilisation over the identical script", async ({ page }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 8000);
      await page.goto("/");
      await page.getByTestId("throttle-intensity-full").click();
      await page.getByTestId("throttle-timing-early").click();

      await page.getByTestId("surface-dry").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("start-run").click();
      await page.waitForTimeout(MID_RUN_SAMPLE_MS);
      const dryUtil = Math.max(
        await readNumber(page, "front-utilisation"),
        await readNumber(page, "rear-utilisation"),
      );
      await page.getByTestId("reset").click();

      await page.getByTestId("surface-ice").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("start-run").click();
      await page.waitForTimeout(MID_RUN_SAMPLE_MS);
      const iceUtil = Math.max(
        await readNumber(page, "front-utilisation"),
        await readNumber(page, "rear-utilisation"),
      );

      expect(
        iceUtil,
        "the same script should use more of the ice preset's smaller grip budget",
      ).toBeGreaterThan(dryUtil);
    });

    test("reset returns state, speed, and utilisation to the initial values", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      await page.getByTestId("reset").click();
      const initialState = await page.getByTestId("state-label").textContent();

      await runToFinish(page);
      await page.getByTestId("reset").click();

      await expect(page.getByTestId("state-label")).toHaveText(initialState ?? "Ready");
      const front = await readNumber(page, "front-utilisation");
      const rear = await readNumber(page, "rear-utilisation");
      expect(front, "reset should return front utilisation to (near) zero").toBeLessThan(5);
      expect(rear, "reset should return rear utilisation to (near) zero").toBeLessThan(5);
      expect(await readNumber(page, "speed"), "reset should return the car to rest").toBe(0);
    });

    test("pressing Run again from finished starts a fresh run without a forced Reset", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS * 2 + 5000);
      await page.goto("/");
      await page.getByTestId("reset").click();
      await runToFinish(page);

      // No Reset click here — Run must work directly from "finished".
      await page.getByTestId("start-run").click();
      await expect(
        page.getByTestId("state-label"),
        "Run from finished should leave the finished label for a fresh running state",
      ).not.toContainText("Finished");
      expect(
        await readNumber(page, "speed"),
        "Run from finished should re-enter the corner at the documented entry speed",
      ).toBeGreaterThan(5);

      await expect(page.getByTestId("state-label")).toContainText("Finished", {
        timeout: FINISH_TIMEOUT_MS,
      });
    });

    test("setting pickers are disabled only while a run is in progress", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      await page.getByTestId("reset").click();
      await expect(page.getByTestId("drivetrain-fwd")).toBeEnabled();
      await expect(page.getByTestId("throttle-intensity-full")).toBeEnabled();
      await expect(page.getByTestId("track-hairpin-right")).toBeEnabled();

      await page.getByTestId("start-run").click();
      await expect(page.getByTestId("drivetrain-fwd")).toBeDisabled();
      await expect(page.getByTestId("throttle-intensity-full")).toBeDisabled();
      await expect(page.getByTestId("track-hairpin-right")).toBeDisabled();

      await expect(page.getByTestId("state-label")).toContainText("Finished", {
        timeout: FINISH_TIMEOUT_MS,
      });
      await expect(page.getByTestId("drivetrain-fwd")).toBeEnabled();
      await expect(page.getByTestId("throttle-intensity-full")).toBeEnabled();
      await expect(page.getByTestId("track-hairpin-right")).toBeEnabled();
    });

    test("all setting pickers and run controls remain keyboard-focusable", async ({ page }) => {
      await page.goto("/");
      for (const testid of [
        "start-run",
        "reset",
        "drivetrain-fwd",
        "drivetrain-rwd",
        "drivetrain-awd",
        "surface-dry",
        "surface-wet",
        "surface-ice",
        "throttle-intensity-light",
        "throttle-intensity-medium",
        "throttle-intensity-full",
        "throttle-timing-early",
        "throttle-timing-mid",
        "throttle-timing-late",
        "track-sweep-left",
        "track-sweep-right",
        "track-hairpin-left",
        "track-hairpin-right",
      ]) {
        await page.getByTestId(testid).focus();
        await expect(page.getByTestId(testid)).toBeFocused();
      }
    });

    test("selecting the hairpin track reaches saturation sooner than the sweep, same drivetrain/surface/throttle", async ({
      page,
    }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 8000);
      await page.goto("/");
      await page.getByTestId("throttle-intensity-full").click();
      await page.getByTestId("throttle-timing-early").click();

      await page.getByTestId("track-sweep-right").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("start-run").click();
      await page.waitForTimeout(MID_RUN_SAMPLE_MS);
      const sweepUtil = Math.max(
        await readNumber(page, "front-utilisation"),
        await readNumber(page, "rear-utilisation"),
      );
      await page.getByTestId("reset").click();

      await page.getByTestId("track-hairpin-right").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("start-run").click();
      await page.waitForTimeout(MID_RUN_SAMPLE_MS);
      const hairpinUtil = Math.max(
        await readNumber(page, "front-utilisation"),
        await readNumber(page, "rear-utilisation"),
      );

      expect(
        hairpinUtil,
        "the tighter hairpin should use more of the shared grip budget than the sweep over the identical script",
      ).toBeGreaterThan(sweepUtil);
    });
  });
}

test("survives a resize mid-run, keeping simulation state and no console errors", async ({ page }) => {
  test.setTimeout(FINISH_TIMEOUT_MS + 5000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/");
  await page.getByTestId("reset").click();
  await page.getByTestId("start-run").click();
  await page.waitForTimeout(1000);
  const before = await readNumber(page, "front-utilisation");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const after = await readNumber(page, "front-utilisation");

  expect(errors, `console errors after mid-run resize: ${errors.join("; ")}`).toEqual([]);
  expect(
    Math.abs(after - before),
    "resizing mid-run should not reset or discontinuously jump the simulation state",
  ).toBeLessThan(30);
});
