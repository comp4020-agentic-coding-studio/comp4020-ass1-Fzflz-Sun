import type { HeldControls } from "../simulation/index.ts";

type HeldKey = keyof HeldControls;

const ARROW_WASD_KEYS: Record<string, HeldKey> = {
  ArrowLeft: "steerLeft",
  KeyA: "steerLeft",
  ArrowRight: "steerRight",
  KeyD: "steerRight",
  ArrowUp: "throttle",
  KeyW: "throttle",
  ArrowDown: "brake",
  KeyS: "brake",
};

export interface DrivingButtons {
  steerLeft: HTMLElement;
  steerRight: HTMLElement;
  throttle: HTMLElement;
  brake: HTMLElement;
}

export interface HeldControlsTracker {
  getHeld(): HeldControls;
  dispose(): void;
}

/** Wires keyboard (Arrows + WASD, held anywhere on the page), pointer
 * (covers mouse and touch — `pointerdown`/`pointerup`, matching
 * e2e/viewport.spec.ts's `holdControl`), and per-button Enter/Space into one
 * held-controls state. Each control tracks *why* it's held in a set of
 * source tags rather than a single boolean, so releasing one input source
 * (e.g. lifting a finger) never clobbers another still-active source (e.g. a
 * key still held) — without that, overlapping input sources could leave a
 * control stuck on or drop it early. */
export function createHeldControlsTracker(buttons: DrivingButtons): HeldControlsTracker {
  const sources: Record<HeldKey, Set<string>> = {
    steerLeft: new Set(),
    steerRight: new Set(),
    throttle: new Set(),
    brake: new Set(),
  };

  function setHeld(key: HeldKey, source: string, active: boolean): void {
    if (active) sources[key].add(source);
    else sources[key].delete(source);
  }

  const disposers: Array<() => void> = [];
  function on<K extends keyof HTMLElementEventMap>(
    target: EventTarget,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, handler as EventListener);
    disposers.push(() => target.removeEventListener(type, handler as EventListener));
  }

  function onKeyDown(event: KeyboardEvent): void {
    const key = ARROW_WASD_KEYS[event.code];
    if (key) setHeld(key, "key", true);
  }
  function onKeyUp(event: KeyboardEvent): void {
    const key = ARROW_WASD_KEYS[event.code];
    if (key) setHeld(key, "key", false);
  }
  on(document, "keydown", onKeyDown);
  on(document, "keyup", onKeyUp);

  const entries: Array<[HeldKey, HTMLElement]> = [
    ["steerLeft", buttons.steerLeft],
    ["steerRight", buttons.steerRight],
    ["throttle", buttons.throttle],
    ["brake", buttons.brake],
  ];

  for (const [key, element] of entries) {
    element.setAttribute("data-held", "false");
    const setPointer = (active: boolean) => {
      setHeld(key, "pointer", active);
      element.setAttribute("data-held", String(sources[key].size > 0));
    };
    on(element, "pointerdown", (event) => {
      event.preventDefault();
      setPointer(true);
    });
    on(element, "pointerup", () => setPointer(false));
    on(element, "pointercancel", () => setPointer(false));
    on(element, "pointerleave", () => setPointer(false));

    const setKeyboard = (active: boolean) => {
      setHeld(key, "button-key", active);
      element.setAttribute("data-held", String(sources[key].size > 0));
    };
    on(element, "keydown", (event) => {
      if (event.code === "Enter" || event.code === "Space") {
        event.preventDefault();
        setKeyboard(true);
      }
    });
    on(element, "keyup", (event) => {
      if (event.code === "Enter" || event.code === "Space") {
        setKeyboard(false);
      }
    });
  }

  function getHeld(): HeldControls {
    return {
      steerLeft: sources.steerLeft.size > 0,
      steerRight: sources.steerRight.size > 0,
      throttle: sources.throttle.size > 0,
      brake: sources.brake.size > 0,
    };
  }

  function dispose(): void {
    for (const off of disposers) off();
  }

  return { getHeld, dispose };
}
