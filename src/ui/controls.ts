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
  releaseAll(): void;
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

  // A tap shorter than one frame.step()/getHeld() poll can otherwise start
  // and end between two reads and never register at all — pendingPulse
  // records "this key went active since the last read" independent of
  // whether it's still held by the time getHeld() is called, so getHeld()
  // reports it held for exactly one read before clearing it.
  const pendingPulse: Record<HeldKey, boolean> = {
    steerLeft: false,
    steerRight: false,
    throttle: false,
    brake: false,
  };

  function setHeld(key: HeldKey, source: string, active: boolean): void {
    if (active) {
      sources[key].add(source);
      pendingPulse[key] = true;
    } else {
      sources[key].delete(source);
    }
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
    // Pointer capture keeps pointerup/pointercancel targeted at this element
    // even if the pointer drags off it before release (a real touch failure
    // mode on the phone viewport) — without it, that release event fires on
    // whatever element the pointer ends up over instead, and this listener
    // never sees it, leaving the control stuck "held" until some other input
    // source clears it. Capture makes pointerleave irrelevant as a release
    // signal, so it's intentionally not handled here any more.
    //
    // (Set|release)PointerCapture throw for a pointerId the browser has no
    // active pointer record for — real hardware-originated events always have
    // one, but a synthetically dispatched PointerEvent (as used by
    // e2e/viewport.spec.ts's holdControl, and by any assistive tool that
    // synthesises input) may not. An uncaught throw here would abort the
    // handler before setPointer ever ran, silently dropping the press — so
    // capture is best-effort, not a precondition for registering the input.
    on(element, "pointerdown", (event) => {
      event.preventDefault();
      try {
        element.setPointerCapture?.(event.pointerId);
      } catch {
        // best-effort; see comment above
      }
      setPointer(true);
    });
    on(element, "pointerup", (event) => {
      try {
        element.releasePointerCapture?.(event.pointerId);
      } catch {
        // best-effort; see comment above
      }
      setPointer(false);
    });
    on(element, "pointercancel", (event) => {
      try {
        element.releasePointerCapture?.(event.pointerId);
      } catch {
        // best-effort; see comment above
      }
      setPointer(false);
    });

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
    const held: HeldControls = {
      steerLeft: sources.steerLeft.size > 0 || pendingPulse.steerLeft,
      steerRight: sources.steerRight.size > 0 || pendingPulse.steerRight,
      throttle: sources.throttle.size > 0 || pendingPulse.throttle,
      brake: sources.brake.size > 0 || pendingPulse.brake,
    };
    pendingPulse.steerLeft = false;
    pendingPulse.steerRight = false;
    pendingPulse.throttle = false;
    pendingPulse.brake = false;
    return held;
  }

  // Called on Reset and on losing focus/visibility (main.ts) so a control
  // can never stay stuck "held" past the moment that should have cleared it,
  // regardless of how many sources still think they're holding it.
  function releaseAll(): void {
    for (const [key, element] of entries) {
      sources[key].clear();
      pendingPulse[key] = false;
      element.setAttribute("data-held", "false");
    }
  }

  function dispose(): void {
    for (const off of disposers) off();
  }

  return { getHeld, releaseAll, dispose };
}
