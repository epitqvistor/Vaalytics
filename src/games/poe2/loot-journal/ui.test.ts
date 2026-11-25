import { describe, expect, it } from "vitest";
import { shortcutFromEvent } from "./HotkeyField";
import { fmtClock, fmtDuration, priceSourceLabel, STALE_AFTER_SECS } from "./ui";

const base = { valueStatus: "priced" as const, valueSource: "poe.ninja", valueConfidence: "high" as const, valueNote: null, valueFetchedAt: 1000 };

describe("price source labels", () => {
  it("names the source and confidence, and never hides old or estimated data", () => {
    expect(priceSourceLabel(base, 1000 + 60)).toBe("poe.ninja · high");
    expect(priceSourceLabel(base, 1000 + STALE_AFTER_SECS + 1)).toBe("stale · poe.ninja");
    expect(priceSourceLabel({ ...base, valueNote: "Not in the latest poe.ninja data (it lists only recently traded items); …" }, 1001)).toBe("last listed · low");
    expect(priceSourceLabel({ ...base, valueNote: "Unidentified: one of 7 uniques on Diamond …" }, 1001)).toBe("lowest possible");
    expect(priceSourceLabel({ ...base, valueStatus: "manual" }, 1001)).toBe("your value");
    expect(priceSourceLabel({ ...base, valueStatus: "no_market_data" }, 1001)).toBeNull();
  });

  it("formats map clocks and durations", () => {
    expect(fmtClock(522)).toBe("08:42");
    expect(fmtClock(5661)).toBe("1:34:21");
    expect(fmtDuration(40)).toBe("40 s");
    expect(fmtDuration(3900)).toBe("1 h 05 min");
  });
});

describe("hotkey recording", () => {
  const ev = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  it("builds layout-independent shortcuts and waits while only modifiers are held", () => {
    expect(shortcutFromEvent(ev("KeyS", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+S");
    expect(shortcutFromEvent(ev("F8"))).toBe("F8");
    expect(shortcutFromEvent(ev("F8", { shiftKey: true }))).toBe("Shift+F8");
    expect(shortcutFromEvent(ev("KeyI", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+I");
    expect(shortcutFromEvent(ev("Digit3", { altKey: true }))).toBe("Alt+3");
    expect(shortcutFromEvent(ev("ArrowUp", { ctrlKey: true }))).toBe("Ctrl+Up");
    expect(shortcutFromEvent(ev("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(shortcutFromEvent(ev("ControlRight", { ctrlKey: true }))).toBeNull();
  });
});
