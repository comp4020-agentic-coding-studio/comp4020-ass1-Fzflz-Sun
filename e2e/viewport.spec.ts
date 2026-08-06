import { expect, test } from "@playwright/test";

// Turns assessment spec line #3 ("works at both marking viewports") and
// spec/brief.md's "core interaction, stated testably" into real-browser
// checks. Runs against the built site via playwright.config.ts's webServer.
//
// The interaction: holding the throttle control while steering is deflected
// raises front/rear axle utilisation; sustained saturation flips the visible
// state label and explanation, and moves the car off the reference line.
// Drivetrain and surface controls change how/when that saturation happens.
const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "phone", width: 390, height: 844 },
] as const;

async function readNumber(page: import("@playwright/test").Page, testid: string): Promise<number> {
  const text = await page.getByTestId(testid).textContent();
  const n = Number.parseFloat((text ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

// Holds a button-style control for a simulated duration by dispatching the
// pointer down/up pair, giving the fixed-step simulation time to integrate.
async function holdControl(
  page: import("@playwright/test").Page,
  testid: string,
  ms: number,
): Promise<void> {
  const control = page.getByTestId(testid);
  await control.dispatchEvent("pointerdown");
  await page.waitForTimeout(ms);
  await control.dispatchEvent("pointerup");
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

    test("holding throttle while steering raises axle utilisation, by pointer", async ({ page }) => {
      await page.goto("/");
      await page.getByTestId("reset").click();
      const before = await readNumber(page, "front-utilisation");
      await page.getByTestId("steer-right").dispatchEvent("pointerdown");
      await holdControl(page, "throttle", 1500);
      await page.getByTestId("steer-right").dispatchEvent("pointerup");
      const after = await readNumber(page, "front-utilisation");
      expect(after, "front-utilisation should rise once throttle is held while steering").toBeGreaterThan(
        before,
      );
    });

    test("keyboard activation (Arrow keys) produces the same class of change as pointer", async ({
      page,
    }) => {
      await page.goto("/");
      await page.getByTestId("reset").click();
      const before = await readNumber(page, "rear-utilisation");
      await page.keyboard.down("ArrowRight");
      await page.keyboard.down("ArrowUp");
      await page.waitForTimeout(1500);
      await page.keyboard.up("ArrowUp");
      await page.keyboard.up("ArrowRight");
      const after = await readNumber(page, "rear-utilisation");
      expect(after, "rear-utilisation should rise from keyboard steering+throttle too").toBeGreaterThan(
        before,
      );
    });

    test("selecting RWD changes which axle saturates first, versus FWD", async ({ page }) => {
      await page.goto("/");

      await page.getByTestId("drivetrain-fwd").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("steer-right").dispatchEvent("pointerdown");
      await holdControl(page, "throttle", 2000);
      const fwdFront = await readNumber(page, "front-utilisation");
      const fwdRear = await readNumber(page, "rear-utilisation");
      await page.getByTestId("steer-right").dispatchEvent("pointerup");

      await page.getByTestId("drivetrain-rwd").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("steer-right").dispatchEvent("pointerdown");
      await holdControl(page, "throttle", 2000);
      const rwdFront = await readNumber(page, "front-utilisation");
      const rwdRear = await readNumber(page, "rear-utilisation");
      await page.getByTestId("steer-right").dispatchEvent("pointerup");

      // FWD pushes drive demand onto the front axle, RWD onto the rear, so
      // for the same steering+throttle input FWD's front share should exceed
      // RWD's, and RWD's rear share should exceed FWD's.
      expect(fwdFront, "FWD should load the front axle more than RWD does").toBeGreaterThan(rwdFront);
      expect(rwdRear, "RWD should load the rear axle more than FWD does").toBeGreaterThan(fwdRear);
    });

    test("selecting the low-grip surface lowers the throttle needed to saturate an axle", async ({
      page,
    }) => {
      await page.goto("/");

      await page.getByTestId("surface-dry").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("steer-right").dispatchEvent("pointerdown");
      await holdControl(page, "throttle", 1200);
      const dryUtil = Math.max(
        await readNumber(page, "front-utilisation"),
        await readNumber(page, "rear-utilisation"),
      );
      await page.getByTestId("steer-right").dispatchEvent("pointerup");

      await page.getByTestId("surface-ice").click();
      await page.getByTestId("reset").click();
      await page.getByTestId("steer-right").dispatchEvent("pointerdown");
      await holdControl(page, "throttle", 1200);
      const iceUtil = Math.max(
        await readNumber(page, "front-utilisation"),
        await readNumber(page, "rear-utilisation"),
      );
      await page.getByTestId("steer-right").dispatchEvent("pointerup");

      expect(iceUtil, "the same inputs should use more of the ice preset's smaller grip budget").toBeGreaterThan(
        dryUtil,
      );
    });

    test("reset returns state, steering and utilisation to the initial values", async ({ page }) => {
      await page.goto("/");
      const initialState = await page.getByTestId("state-label").textContent();
      await page.getByTestId("steer-right").dispatchEvent("pointerdown");
      await holdControl(page, "throttle", 1500);
      await page.getByTestId("steer-right").dispatchEvent("pointerup");
      await page.getByTestId("reset").click();
      await expect(page.getByTestId("state-label")).toHaveText(initialState ?? "Stable");
      const front = await readNumber(page, "front-utilisation");
      const rear = await readNumber(page, "rear-utilisation");
      expect(front, "reset should return front utilisation to (near) zero").toBeLessThan(5);
      expect(rear, "reset should return rear utilisation to (near) zero").toBeLessThan(5);
    });

    test("all controls remain keyboard-focusable", async ({ page }) => {
      await page.goto("/");
      for (const testid of [
        "steer-left",
        "steer-right",
        "throttle",
        "brake",
        "reset",
        "drivetrain-fwd",
        "drivetrain-rwd",
        "drivetrain-awd",
        "surface-dry",
        "surface-wet",
        "surface-ice",
      ]) {
        await page.getByTestId(testid).focus();
        await expect(page.getByTestId(testid)).toBeFocused();
      }
    });
  });
}

test("survives a resize mid-interaction, keeping simulation state and no console errors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/");
  await page.getByTestId("reset").click();
  await page.getByTestId("steer-right").dispatchEvent("pointerdown");
  await holdControl(page, "throttle", 1000);
  const before = await readNumber(page, "front-utilisation");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const after = await readNumber(page, "front-utilisation");
  await page.getByTestId("steer-right").dispatchEvent("pointerup");

  expect(errors, `console errors after mid-interaction resize: ${errors.join("; ")}`).toEqual([]);
  expect(
    Math.abs(after - before),
    "resizing mid-run should not reset or discontinuously jump the simulation state",
  ).toBeLessThan(30);
});
