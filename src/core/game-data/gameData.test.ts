import { describe, expect, it } from "vitest";
import { patchById, patchFor } from "./index";
import { POE1_PATCHES } from "./poe1";

describe("versioned game data", () => {
  it("maps the 3.30 challenge leagues to the 3.30 rules", () => {
    for (const league of ["Covens", "Hardcore Covens"]) {
      const r = patchFor("poe1", league);
      expect(r.definition?.patch).toBe("3.30");
      expect(r.assumed).toBe(false);
    }
    const m = patchById("poe1", "3.30")!.mechanics!;
    expect(m.scarabs.value).toBe(false);
    expect(m.threads.value).toBe(true);
    expect(m.atlasPassivePoints.value).toBe(150);
  });

  it("permanent leagues follow the current patch; unknown leagues are flagged", () => {
    expect(patchFor("poe1", "Standard")).toMatchObject({ permanent: true, assumed: false });
    expect(patchFor("poe1", "Hardcore").definition?.patch).toBe("3.30");
    const unknown = patchFor("poe1", "Some Event League");
    expect(unknown.assumed).toBe(true);
    expect(unknown.definition?.patch).toBe("3.30");
  });

  it("keeps older rules separate", () => {
    const old = patchById("poe1", "pre-3.30")!.mechanics!;
    expect(old.scarabs.value).toBe(true);
    expect(old.atlasPassivePoints.value).toBe(138);
  });

  it("PoE 2 has no definitions yet (no PoE 1 rules assumed)", () => {
    expect(patchFor("poe2", "Runes of Aldur").definition).toBeNull();
  });

  it("confirmed facts cite a source; unverified ones are marked", () => {
    for (const p of POE1_PATCHES) {
      for (const [k, f] of Object.entries(p.mechanics ?? {})) {
        if (f.verification === "confirmed") expect(p.sources[f.source ?? -1], `${p.patch}.${k}`).toBeDefined();
      }
    }
    expect(patchById("poe1", "3.30")!.mechanics!.grimFates.verification).toBe("unverified");
  });
});
