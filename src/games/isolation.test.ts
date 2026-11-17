/**
 * Architecture guard (ADR 0002): game modules must never import each other.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("game isolation", () => {
  for (const [game, other] of [
    ["poe1", "poe2"],
    ["poe2", "poe1"],
  ] as const) {
    it(`${game} does not import ${other}`, () => {
      const offenders = sourceFiles(join(ROOT, "games", game)).filter((f) =>
        new RegExp(`from\\s+["'](@/games/${other}|\\.\\./\\.\\./${other}|\\.\\./${other})`).test(readFileSync(f, "utf8")),
      );
      expect(offenders).toEqual([]);
    });
  }

  it("shared and core never import a specific game module", () => {
    const offenders = [...sourceFiles(join(ROOT, "shared")), ...sourceFiles(join(ROOT, "core"))].filter((f) =>
      /from\s+["']@\/games\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
