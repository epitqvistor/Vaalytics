import { describe, expect, it } from "vitest";
import { matchesShortcut } from "./shortcut";

const ev = (key: string, code: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  key,
  code,
  ctrlKey: !!m.ctrl,
  shiftKey: !!m.shift,
  altKey: !!m.alt,
  metaKey: !!m.meta,
});

describe("matchesShortcut", () => {
  it("matches the price-check hotkey options exactly", () => {
    expect(matchesShortcut(ev("d", "KeyD", { ctrl: true }), "Ctrl+D")).toBe(true);
    expect(matchesShortcut(ev("D", "KeyD", { ctrl: true, shift: true }), "Ctrl+Shift+D")).toBe(true);
    expect(matchesShortcut(ev("d", "KeyD", { alt: true }), "Alt+D")).toBe(true);
    expect(matchesShortcut(ev("d", "KeyD", { ctrl: true, alt: true }), "Ctrl+Alt+D")).toBe(true);
  });

  it("requires the exact modifiers", () => {
    expect(matchesShortcut(ev("D", "KeyD", { ctrl: true, shift: true }), "Ctrl+D")).toBe(false);
    expect(matchesShortcut(ev("d", "KeyD"), "Ctrl+D")).toBe(false);
    expect(matchesShortcut(ev("c", "KeyC", { ctrl: true }), "Ctrl+D")).toBe(false);
  });

  it("uses the physical key, so other layouts still match", () => {
    expect(matchesShortcut(ev("в", "KeyD", { ctrl: true }), "Ctrl+D")).toBe(true);
  });

  it("rejects empty shortcuts", () => {
    expect(matchesShortcut(ev("d", "KeyD", { ctrl: true }), "")).toBe(false);
  });
});
