/** Campaign settings: Custom categories, level gap, pinned objectives, linked PoB build, character visibility. */
import { useEffect, useState } from "react";
import { campaignDeleteCharacter, campaignSetHidden, pobBuilds, type CampaignBuildStats, type CampaignCharacter, type PobBuild } from "@/core/ipc/commands";
import { Button, Checkbox, Input, Modal, Panel, Select, useToast } from "@/shared/components";
import type { ObjectiveCategory } from "./data/types";
import { campaignGraph } from "./hooks";
import { CATEGORY_LABEL, MODE_HELP, MODE_LABEL, type CampaignConfig } from "./settings";
import { SectionLabel } from "./ui";

const GAME = "poe2" as const;
const CUSTOM_CATEGORIES: ObjectiveCategory[] = ["passive", "spirit", "resistance", "life-mana", "charm", "choice", "ascendancy", "unlock", "optional-boss"];

export function SettingsTab({
  config,
  setConfig,
  character,
  characters,
  build,
  buildError,
  buildLines,
  onCharactersChanged,
}: {
  config: CampaignConfig;
  setConfig: (c: CampaignConfig) => void;
  character: CampaignCharacter;
  characters: CampaignCharacter[];
  build: CampaignBuildStats | null;
  buildError: string | null;
  buildLines: string[];
  onCharactersChanged: () => void;
}) {
  const notify = useToast();
  const g = campaignGraph();
  const [builds, setBuilds] = useState<PobBuild[] | null>(null);
  const [toDelete, setToDelete] = useState<CampaignCharacter | null>(null);
  useEffect(() => {
    pobBuilds(GAME)
      .then(setBuilds)
      .catch(() => setBuilds([]));
  }, []);
  const linked = (config.builds ?? {})[String(character.id)] ?? "";
  const setBuild = (rel: string) => {
    const next = { ...(config.builds ?? {}) };
    if (rel) next[String(character.id)] = rel;
    else delete next[String(character.id)];
    setConfig({ ...config, builds: next });
  };
  const toggleCategory = (c: ObjectiveCategory, on: boolean) =>
    setConfig({ ...config, categories: on ? [...new Set([...config.categories, c])] : config.categories.filter((x) => x !== c) });

  const act = async (f: () => Promise<void>, what: string) => {
    try {
      await f();
      onCharactersChanged();
    } catch (e) {
      notify("warning", `Couldn't ${what}`, String(e));
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Campaign mode">
        <p className="text-xs text-fg-muted">
          <span className="text-fg">{MODE_LABEL[config.mode]}:</span> {MODE_HELP[config.mode]} Changing the mode never resets progress.
        </p>
        <div className="mt-4">
          <SectionLabel>Custom mode — reward types to pursue</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {CUSTOM_CATEGORIES.map((c) => (
              <Checkbox key={c} label={CATEGORY_LABEL[c]} checked={config.categories.includes(c)} onChange={(on) => toggleCategory(c, on)} />
            ))}
          </div>
          <p className="mt-2 text-2xs text-fg-subtle">The main quest is always included.</p>
        </div>
        <div className="mt-4 max-w-[220px]">
          <Input
            label="Level-gap warning"
            type="number"
            min={1}
            max={20}
            value={config.levelGap}
            suffix="levels"
            hint="Warn when the next main zone is this many levels above you; Power Leveling uses it too."
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (n >= 1 && n <= 20) setConfig({ ...config, levelGap: n });
            }}
          />
        </div>
      </Panel>

      <Panel title="Build-aware hints">
        <p className="text-xs text-fg-muted">
          Link a Path of Building (PoE 2) build to this character. Vaalytics reads only its planned Spirit, resistances and attributes — numbers for the
          build's intended gear, not your character's live stats — and uses them to re-rank rewards. Nothing is changed in the build.
        </p>
        <div className="mt-3">
          <Select
            label="Build"
            value={linked}
            onChange={setBuild}
            options={[
              { value: "", label: builds === null ? "Loading builds…" : builds.length ? "No build linked" : "No PoB builds found" },
              ...(builds ?? []).map((b) => {
                const rel = b.folder ? `${b.folder}/${b.name}` : b.name;
                return { value: rel, label: rel };
              }),
            ]}
          />
        </div>
        {buildError && <p className="mt-2 text-xs text-warning">{buildError}</p>}
        {build && (
          <div className="mt-3">
            <SectionLabel>
              {build.name} · {build.ascendClassName ?? build.className ?? "unknown class"}
              {build.level ? ` · level ${build.level}` : ""}
            </SectionLabel>
            <ul className="flex flex-col gap-1 text-xs text-fg-muted">
              {buildLines.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
          </div>
        )}
        {!linked && <p className="mt-2 text-2xs text-fg-subtle">Without a build, recommendations are generic.</p>}
      </Panel>

      <Panel title="Pinned objectives">
        {config.pinned.length === 0 ? (
          <p className="text-xs text-fg-muted">Nothing pinned. “Do this next” in the navigator pins an objective for this visit only.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {config.pinned.map((id) => (
              <li key={id} className="flex items-center gap-2 text-sm text-fg">
                <span className="flex-1">{g.objective.get(id)?.title ?? id}</span>
                <Button size="sm" variant="ghost" onClick={() => setConfig({ ...config, pinned: config.pinned.filter((x) => x !== id) })}>
                  Unpin
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Characters">
        <p className="mb-3 text-xs text-fg-muted">
          Characters are recognised from level-up lines. A party member who levelled first after a login can be mistaken for you — hide or delete it here.
        </p>
        <ul className="flex flex-col gap-1.5">
          {characters.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm text-fg">
              <span className="flex-1 truncate">
                {c.name} · {c.class} · {c.level}
                <span className="ml-1.5 text-xs text-fg-muted">{c.campaignZones} campaign areas</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => act(() => campaignSetHidden(GAME, c.id, !c.hidden), "update the character")}>
                {c.hidden ? "Show" : "Hide"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setToDelete(c)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Modal
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="Delete character?"
        description={toDelete ? `${toDelete.name}'s campaign events and your marks for it are deleted. A later history import would find the character again from Client.txt.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const c = toDelete!;
                setToDelete(null);
                void act(() => campaignDeleteCharacter(GAME, c.id), "delete the character");
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
