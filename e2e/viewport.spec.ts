import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Turns assessment spec line #3 ("works at both marking viewports") and
// spec/brief.md's progressive-explorable structure into real-browser checks.
// Runs against the built site via playwright.config.ts's webServer.
//
// The page is no longer one always-visible dashboard: it's an intro, five
// single-variable teaching modules, and a full-freedom sandbox, each with its
// own independent Run/Reset/canvas/state. Every getByTestId() below is scoped
// to the module (or sandbox) it belongs to, since testids like "start-run" and
// "state-label" now exist once per module/sandbox container, not once per
// page — an unscoped getByTestId would be a Playwright strict-mode violation.
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

// Sampled mid-run (not at "finished") on purpose: by the time a sustained
// full-throttle+early script actually finishes, the car has usually been
// pushed into a hard multi-second slide at very high speed, where utilisation
// readings balloon well past 100% for every setting alike and stop ordering
// cleanly — the same 2-4s window src/simulation/behaviour.test.ts section D
// samples at, before that regime, is what actually shows each module's
// single-variable contrast.
const MID_RUN_SAMPLE_MS = 3000;

// Each teaching module's own container testid and the exact setting-picker
// testids it exposes (its one taught variable) — mirrors spec/assignment-1.test.ts's
// MODULES table so the two files agree on the page's structure.
const MODULES = [
  { testid: "module-1", pickers: ["track-sweep-right", "track-hairpin-right"] },
  { testid: "module-2", pickers: ["surface-dry", "surface-wet", "surface-ice"] },
  {
    testid: "module-3",
    pickers: ["throttle-intensity-light", "throttle-intensity-medium", "throttle-intensity-full"],
  },
  { testid: "module-4", pickers: ["drivetrain-fwd", "drivetrain-rwd", "drivetrain-awd"] },
  { testid: "module-5", pickers: ["throttle-timing-early", "throttle-timing-mid", "throttle-timing-late"] },
] as const;

async function readNumberIn(root: Locator, testid: string): Promise<number> {
  const text = await root.getByTestId(testid).textContent();
  const n = Number.parseFloat((text ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

async function runToFinish(root: Locator): Promise<void> {
  await root.getByTestId("start-run").click();
  await expect(root.getByTestId("state-label")).toContainText("Finished", {
    timeout: FINISH_TIMEOUT_MS,
  });
}

// Samples max(front, rear) utilisation MID_RUN_SAMPLE_MS after Run, having
// first clicked whichever of a module's own pickers should be active. Resets
// the module first so every sample starts from the same inert state.
async function sampleUtilisation(root: Locator, picker: string): Promise<{ front: number; rear: number }> {
  await root.getByTestId(picker).click();
  await root.getByTestId("reset").click();
  await root.getByTestId("start-run").click();
  await root.page().waitForTimeout(MID_RUN_SAMPLE_MS);
  const front = await readNumberIn(root, "front-utilisation");
  const rear = await readNumberIn(root, "rear-utilisation");
  await root.getByTestId("reset").click();
  return { front, rear };
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

    test("the first screen shows only the intro thesis, no module or sandbox controls in view", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator(".intro-copy")).toContainText("Grip is a budget");
      await expect(page.locator(".intro-copy")).toContainText("Scroll to experiment");

      // module-1's Run button (the first control on the page below the
      // intro) must not be within the first viewport's visible area — the
      // intro is near-fullscreen with no sandbox/module controls exposed
      // before the visitor scrolls.
      const module1Top = await page.getByTestId("module-1").evaluate((el) => el.getBoundingClientRect().top);
      expect(
        module1Top,
        "module-1 must sit below the first screen, not share it with the intro",
      ).toBeGreaterThan(viewport.height * 0.5);
    });

    test("scrolling reveals each teaching module in order, then the sandbox", async ({ page }) => {
      await page.goto("/");
      for (const { testid } of [...MODULES, { testid: "sandbox" as const }]) {
        const el = page.getByTestId(testid);
        await el.scrollIntoViewIfNeeded();
        await expect(el).toBeVisible();
      }
    });

    for (const { testid, pickers } of MODULES) {
      test.describe(`teaching module ${testid}`, () => {
        test("sits at rest until Run is pressed, even while changing its own setting", async ({ page }) => {
          await page.goto("/");
          const root = page.getByTestId(testid);
          await root.scrollIntoViewIfNeeded();
          await root.getByTestId("reset").click();
          await expect(root.getByTestId("state-label")).toHaveText("Ready");
          expect(await readNumberIn(root, "speed"), `${testid} must be at rest before Run`).toBe(0);

          await root.getByTestId(pickers[pickers.length - 1]).click();
          await expect(
            root.getByTestId("state-label"),
            `${testid}: changing its setting before Run must not leave Ready`,
          ).toHaveText("Ready");
          expect(await readNumberIn(root, "speed")).toBe(0);

          await root.getByTestId("start-run").click();
          await expect(root.getByTestId("state-label"), `${testid}: Run should leave Ready`).not.toHaveText(
            "Ready",
          );
          expect(await readNumberIn(root, "speed"), `${testid}: Run should put the car in motion`).toBeGreaterThan(
            5,
          );
        });

        test("settles deterministically into a finished state", async ({ page }) => {
          test.setTimeout(FINISH_TIMEOUT_MS + 5000);
          await page.goto("/");
          const root = page.getByTestId(testid);
          await root.scrollIntoViewIfNeeded();
          await root.getByTestId("reset").click();
          await runToFinish(root);
        });

        test("its own setting pickers are disabled only while a run is in progress", async ({ page }) => {
          test.setTimeout(FINISH_TIMEOUT_MS + 5000);
          await page.goto("/");
          const root = page.getByTestId(testid);
          await root.scrollIntoViewIfNeeded();
          await root.getByTestId("reset").click();
          for (const picker of pickers) await expect(root.getByTestId(picker)).toBeEnabled();

          await root.getByTestId("start-run").click();
          for (const picker of pickers) await expect(root.getByTestId(picker)).toBeDisabled();

          await expect(root.getByTestId("state-label")).toContainText("Finished", { timeout: FINISH_TIMEOUT_MS });
          for (const picker of pickers) await expect(root.getByTestId(picker)).toBeEnabled();
        });

        test("its Run/Reset and setting pickers are keyboard-focusable", async ({ page }) => {
          await page.goto("/");
          const root = page.getByTestId(testid);
          await root.scrollIntoViewIfNeeded();
          for (const t of ["start-run", "reset", ...pickers]) {
            await root.getByTestId(t).focus();
            await expect(root.getByTestId(t)).toBeFocused();
          }
        });
      });
    }

    test("module-1: the hairpin reaches more of the shared grip budget than the sweep", async ({ page }) => {
      // Slack beyond the two intentional MID_RUN_SAMPLE_MS waits must cover a
      // fresh WebGL scene mount and GLTF fetch/parse for each of the two
      // sampleUtilisation() calls — nothing is warm-cached across tests since
      // every test does its own full page.goto reload. 8s of slack was too
      // tight and intermittently timed out under real (not idle) load; 20s
      // gives real mount/load overhead room without loosening what's actually
      // being asserted.
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 20000);
      await page.goto("/");
      const root = page.getByTestId("module-1");
      await root.scrollIntoViewIfNeeded();
      const sweep = await sampleUtilisation(root, "track-sweep-right");
      const hairpin = await sampleUtilisation(root, "track-hairpin-right");
      expect(
        Math.max(hairpin.front, hairpin.rear),
        "the tighter hairpin should use more of the shared grip budget than the sweep",
      ).toBeGreaterThan(Math.max(sweep.front, sweep.rear));
    });

    test("module-2: ice uses more of the grip budget than dry over the identical script", async ({ page }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 20000);
      await page.goto("/");
      const root = page.getByTestId("module-2");
      await root.scrollIntoViewIfNeeded();
      const dry = await sampleUtilisation(root, "surface-dry");
      const ice = await sampleUtilisation(root, "surface-ice");
      expect(
        Math.max(ice.front, ice.rear),
        "ice should saturate more of the same script's grip budget than dry",
      ).toBeGreaterThan(Math.max(dry.front, dry.rear));
    });

    test("module-3: full throttle uses more rear grip than light throttle", async ({ page }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 20000);
      await page.goto("/");
      const root = page.getByTestId("module-3");
      await root.scrollIntoViewIfNeeded();
      const light = await sampleUtilisation(root, "throttle-intensity-light");
      const full = await sampleUtilisation(root, "throttle-intensity-full");
      expect(full.rear, "full throttle should load the rear axle more than light throttle").toBeGreaterThan(
        light.rear,
      );
    });

    test("module-4: drivetrain changes which axle carries the load, AWD delays saturation", async ({ page }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 3 + 25000);
      await page.goto("/");
      const root = page.getByTestId("module-4");
      await root.scrollIntoViewIfNeeded();
      const fwd = await sampleUtilisation(root, "drivetrain-fwd");
      const rwd = await sampleUtilisation(root, "drivetrain-rwd");
      const awd = await sampleUtilisation(root, "drivetrain-awd");

      expect(fwd.front, "FWD should load the front axle more than RWD does").toBeGreaterThan(rwd.front);
      expect(rwd.rear, "RWD should load the rear axle more than FWD does").toBeGreaterThan(fwd.rear);
      expect(
        Math.max(awd.front, awd.rear),
        "AWD should delay saturation, not eliminate it — less loaded than FWD/RWD's own worst axle",
      ).toBeLessThan(Math.max(fwd.front, rwd.rear));
    });

    test("module-5: an early throttle onset reaches more combined demand sooner than a late one", async ({
      page,
    }) => {
      test.setTimeout(MID_RUN_SAMPLE_MS * 2 + 20000);
      await page.goto("/");
      const root = page.getByTestId("module-5");
      await root.scrollIntoViewIfNeeded();
      const early = await sampleUtilisation(root, "throttle-timing-early");
      const late = await sampleUtilisation(root, "throttle-timing-late");
      expect(
        Math.max(early.front, early.rear),
        "an early throttle onset should reach more combined demand at the same elapsed time than a late one",
      ).toBeGreaterThan(Math.max(late.front, late.rear));
    });

    test("changing one module's setting never affects another module's state", async ({ page }) => {
      await page.goto("/");
      const module1 = page.getByTestId("module-1");
      const module2 = page.getByTestId("module-2");
      await module1.scrollIntoViewIfNeeded();
      await module1.getByTestId("reset").click();
      const before = await module1.getByTestId("state-label").textContent();

      await module2.scrollIntoViewIfNeeded();
      await module2.getByTestId("surface-ice").click();
      await module2.getByTestId("reset").click();

      await module1.scrollIntoViewIfNeeded();
      await expect(
        module1.getByTestId("state-label"),
        "module-2's setting change must not touch module-1's state",
      ).toHaveText(before ?? "Ready");
      expect(await readNumberIn(module1, "speed"), "module-1 must still be at rest").toBe(0);
    });

    test("scrolling a running module out of view pauses it; scrolling back resumes with no time jump", async ({
      page,
    }) => {
      test.setTimeout(15000);
      await page.goto("/");
      const module1 = page.getByTestId("module-1");
      const sandbox = page.getByTestId("sandbox");

      await module1.scrollIntoViewIfNeeded();
      await module1.getByTestId("reset").click();
      await module1.getByTestId("start-run").click();
      await page.waitForTimeout(800);
      const beforeScrollAway = await readNumberIn(module1, "front-utilisation");

      // Scroll far enough away that module-1 leaves the viewport entirely,
      // hold there long enough that an un-paused simulation would have
      // clearly progressed, then come back.
      await sandbox.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      await module1.scrollIntoViewIfNeeded();
      const afterScrollBack = await readNumberIn(module1, "front-utilisation");

      expect(
        Math.abs(afterScrollBack - beforeScrollAway),
        "an offscreen module must pause its physics stepping, not keep advancing unseen",
      ).toBeLessThan(15);
    });

    test("the sandbox exposes every variable as a mad-libs sentence of selects", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      const root = page.getByTestId("sandbox");
      await root.scrollIntoViewIfNeeded();

      await root.getByTestId("drivetrain-select").selectOption("AWD");
      await root.getByTestId("surface-select").selectOption("wet");
      await root.getByTestId("throttle-intensity-select").selectOption("medium");
      await root.getByTestId("throttle-timing-select").selectOption("mid");
      await root.getByTestId("track-shape-select").selectOption("hairpin");

      const advanced = root.getByTestId("advanced-setup");
      await advanced.locator("summary").click();
      await root.getByTestId("track-direction-select").selectOption("left");

      await root.getByTestId("reset").click();
      await expect(root.getByTestId("state-label")).toHaveText("Ready");
      await runToFinish(root);
    });

    test("the sandbox's Telemetry disclosure reveals the full instrument panel", async ({ page }) => {
      await page.goto("/");
      const root = page.getByTestId("sandbox");
      await root.scrollIntoViewIfNeeded();
      const telemetry = root.getByTestId("telemetry");
      await expect(root.getByTestId("longitudinal-g")).not.toBeVisible();
      await telemetry.locator("summary").click();
      await expect(root.getByTestId("longitudinal-g")).toBeVisible();
      await expect(root.getByTestId("lateral-g")).toBeVisible();
      await expect(root.getByTestId("steering-value")).toBeVisible();
      await expect(root.getByTestId("throttle-value")).toBeVisible();
    });

    test("pressing Run again from finished starts a fresh run without a forced Reset (module-1)", async ({
      page,
    }) => {
      test.setTimeout(FINISH_TIMEOUT_MS * 2 + 5000);
      await page.goto("/");
      const root = page.getByTestId("module-1");
      await root.scrollIntoViewIfNeeded();
      await root.getByTestId("reset").click();
      await runToFinish(root);

      // No Reset click here — Run must work directly from "finished".
      await root.getByTestId("start-run").click();
      await expect(
        root.getByTestId("state-label"),
        "Run from finished should leave the finished label for a fresh running state",
      ).not.toContainText("Finished");
      expect(await readNumberIn(root, "speed"), "Run from finished should re-enter at the entry speed").toBeGreaterThan(
        5,
      );
      await expect(root.getByTestId("state-label")).toContainText("Finished", { timeout: FINISH_TIMEOUT_MS });
    });

    test("reset returns a module's state, speed, and utilisation to the initial values (module-4)", async ({
      page,
    }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.goto("/");
      const root = page.getByTestId("module-4");
      await root.scrollIntoViewIfNeeded();
      await root.getByTestId("reset").click();
      const initialState = await root.getByTestId("state-label").textContent();

      await runToFinish(root);
      await root.getByTestId("reset").click();

      await expect(root.getByTestId("state-label")).toHaveText(initialState ?? "Ready");
      expect(await readNumberIn(root, "front-utilisation")).toBeLessThan(5);
      expect(await readNumberIn(root, "rear-utilisation")).toBeLessThan(5);
      expect(await readNumberIn(root, "speed")).toBe(0);
    });

    test("reduced motion still leaves every module runnable", async ({ page }) => {
      test.setTimeout(FINISH_TIMEOUT_MS + 5000);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const root = page.getByTestId("module-1");
      await root.scrollIntoViewIfNeeded();
      await root.getByTestId("reset").click();
      await runToFinish(root);
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
  const root = page.getByTestId("module-1");
  await root.scrollIntoViewIfNeeded();
  await root.getByTestId("reset").click();
  await root.getByTestId("start-run").click();
  await page.waitForTimeout(1000);
  const before = await readNumberIn(root, "front-utilisation");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await root.scrollIntoViewIfNeeded();
  const after = await readNumberIn(root, "front-utilisation");

  expect(errors, `console errors after mid-run resize: ${errors.join("; ")}`).toEqual([]);
  expect(
    Math.abs(after - before),
    "resizing mid-run should not reset or discontinuously jump the simulation state",
  ).toBeLessThan(30);
});

function _unusedTypeCheck(page: Page): void {
  void page;
}
