/**
 * Guide editor (Act Tracker page): profiles and step edits. The built-in profile is read-only; "Duplicate to edit"
 * makes your own copy. Export copies JSON to the clipboard (only when you press the button); import validates the
 * JSON before anything is saved.
 */
import { useState } from "react";
import { Button, Input, Modal, Panel, Select, useToast } from "@/shared/components";
import { ROUTE_META } from "./data";
import type { StepPriority } from "./engine/priorities";
import {
  BUILT_IN_ID,
  EMPTY_EDITS,
  exportProfile,
  importProfile,
  LIMITS,
  moveEdit,
  newId,
  type GuideEdits,
  type UserProfile,
} from "./engine/profiles";
import { FAST_ALL_PASSIVES, type GuideOptions, type ResolvedStep } from "./engine/route";
import type { TrackerPrefs } from "./prefs";

const now = () => Math.floor(Date.now() / 1000);

/** Edit operations on the active user profile (no-ops for the built-in one). */
export interface StepEditor {
  editable: boolean;
  isHidden: (id: string) => boolean;
  isCustom: (id: string) => boolean;
  canMove: (s: ResolvedStep, dir: -1 | 1) => boolean;
  move: (s: ResolvedStep, dir: -1 | 1) => void;
  toggleHidden: (s: ResolvedStep) => void;
  addAfter: (s: ResolvedStep, text: string) => void;
  removeCustom: (id: string) => void;
  setPriority: (id: string, p: StepPriority | null) => void;
  priorityOf: (id: string) => StepPriority | null;
}

export function useStepEditor(profile: UserProfile | null, profiles: UserProfile[], save: (p: UserProfile[]) => Promise<void>, steps: ResolvedStep[]): StepEditor {
  const notify = useToast();
  const update = (f: (e: GuideEdits) => GuideEdits) => {
    if (!profile) return;
    const next = { ...profile, edits: f(profile.edits), updatedAt: now() };
    save(profiles.map((p) => (p.id === profile.id ? next : p))).catch((e) => notify("warning", "Couldn't save the guide", String(e)));
  };
  return {
    editable: !!profile,
    isHidden: (id) => !!profile?.edits.hidden.includes(id),
    isCustom: (id) => !!profile?.edits.custom.some((c) => c.id === id),
    canMove: (s, dir) => !!profile && moveEdit(steps, s.index, dir) !== null,
    move: (s, dir) => {
      const m = moveEdit(steps, s.index, dir);
      if (m) update((e) => ({ ...e, moves: [...e.moves, m].slice(-LIMITS.moves) }));
    },
    toggleHidden: (s) =>
      update((e) => ({ ...e, hidden: e.hidden.includes(s.id) ? e.hidden.filter((x) => x !== s.id) : [...e.hidden, s.id].slice(0, LIMITS.hidden) })),
    addAfter: (s, text) => {
      const t = text.trim().slice(0, LIMITS.customText);
      if (!t) return;
      update((e) => {
        if (e.custom.length >= LIMITS.customSteps) return e;
        const id = newId("custom", new Set(e.custom.map((c) => c.id)), Date.now() % 1_000_000);
        return { ...e, custom: [...e.custom, { id, after: s.id, text: t }] };
      });
    },
    removeCustom: (id) =>
      update((e) => ({
        ...e,
        custom: e.custom.filter((c) => c.id !== id).map((c) => (c.after === id ? { ...c, after: e.custom.find((x) => x.id === id)?.after ?? c.after } : c)),
        hidden: e.hidden.filter((x) => x !== id),
      })),
    setPriority: (id, p) =>
      update((e) => {
        const priorities = { ...e.priorities };
        if (p) priorities[id] = p;
        else delete priorities[id];
        return { ...e, priorities };
      }),
    priorityOf: (id) => profile?.edits.priorities[id] ?? null,
  };
}

export function ProfilesPanel({
  prefs,
  setPrefs,
  profiles,
  save,
  stale,
}: {
  prefs: TrackerPrefs;
  setPrefs: (p: TrackerPrefs) => void;
  profiles: UserProfile[];
  save: (p: UserProfile[]) => Promise<void>;
  /** Edits of the active profile that point at steps not in this route. */
  stale: number;
}) {
  const notify = useToast();
  const active = profiles.find((p) => p.id === prefs.profileId) ?? null;
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = async (name: string, options: GuideOptions, edits: GuideEdits = EMPTY_EDITS) => {
    if (profiles.length >= LIMITS.profiles) {
      notify("warning", "Too many guides", `Up to ${LIMITS.profiles} of your own guides.`);
      return;
    }
    const id = newId("user", new Set(profiles.map((p) => p.id)), Date.now() % 1_000_000);
    const p: UserProfile = { id, name: name.slice(0, LIMITS.name), options, edits, routeVersion: ROUTE_META.source.version, createdAt: now(), updatedAt: now() };
    await save([...profiles, p]);
    setPrefs({ ...prefs, profileId: id });
    return p;
  };

  const copyExport = async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(exportProfile(active, ROUTE_META.patch));
      notify("success", "Guide copied", "The guide's JSON is on your clipboard.");
    } catch (e) {
      notify("warning", "Couldn't copy", String(e));
    }
  };

  const doImport = async () => {
    const r = importProfile(importText, now(), newId("user", new Set(profiles.map((p) => p.id)), Date.now() % 1_000_000), ROUTE_META.source.version);
    if (!r.ok) {
      notify("warning", "Couldn't import that guide", r.error);
      return;
    }
    if (profiles.length >= LIMITS.profiles) {
      notify("warning", "Too many guides", `Up to ${LIMITS.profiles} of your own guides.`);
      return;
    }
    await save([...profiles, r.profile]);
    setPrefs({ ...prefs, profileId: r.profile.id });
    setImporting(false);
    setImportText("");
    notify("success", `Imported "${r.profile.name}"`, r.warnings.join(" ") || "It is now your active guide.");
  };

  return (
    <Panel title="Guide profiles">
      <div className="flex flex-col gap-3">
        <Select<string>
          label="Active guide"
          value={prefs.profileId}
          onChange={(profileId) => setPrefs({ ...prefs, profileId })}
          options={[{ value: BUILT_IN_ID, label: `${FAST_ALL_PASSIVES.name} (built in)` }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
        />
        {!active ? (
          <p className="text-xs text-fg-muted">
            The built-in guide can't be edited, so it always stays as shipped. Duplicate it to reorder steps, hide steps, add your own instructions or change
            priorities.
          </p>
        ) : (
          <p className="text-xs text-fg-muted">
            Your guide: {active.edits.hidden.length} hidden, {active.edits.moves.length} moved, {active.edits.custom.length} own steps,{" "}
            {Object.keys(active.edits.priorities).length} priorities changed. Edit steps in the guide below (hover a step).
            {stale > 0 && <span className="text-warning"> {stale} edit{stale === 1 ? "" : "s"} point at steps that aren't in this route (other options or route version) and are ignored.</span>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={active ? "secondary" : "primary"}
            onClick={() =>
              void create(active ? `${active.name} (copy)` : "My guide", active ? active.options : prefs.options, active ? active.edits : EMPTY_EDITS)
            }
          >
            {active ? "Duplicate" : "Duplicate to edit"}
          </Button>
          {active && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setRenaming(active.name)}>
                Rename
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void copyExport()}>
                Export (copy)
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setImporting(true)}>
            Import
          </Button>
        </div>
      </div>

      <Modal open={importing} onClose={() => setImporting(false)} title="Import a guide">
        <p className="mb-2 text-xs text-fg-muted">Paste a guide exported from Vaalytics. It is checked before anything is saved.</p>
        <textarea
          className="h-48 w-full rounded-md border border-line bg-well p-2 font-mono text-2xs text-fg"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          aria-label="Guide JSON"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setImporting(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!importText.trim()} onClick={() => void doImport()}>
            Import
          </Button>
        </div>
      </Modal>

      <Modal open={renaming !== null} onClose={() => setRenaming(null)} title="Rename guide">
        <Input value={renaming ?? ""} maxLength={LIMITS.name} onChange={(e) => setRenaming(e.target.value)} aria-label="Guide name" />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!renaming?.trim()}
            onClick={() => {
              if (active && renaming?.trim()) void save(profiles.map((p) => (p.id === active.id ? { ...p, name: renaming.trim().slice(0, LIMITS.name), updatedAt: now() } : p)));
              setRenaming(null);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this guide?">
        <p className="text-sm text-fg-muted">
          "{active?.name}" and its edits will be deleted. Your progress and marks stay. Export it first if you may want it back.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (active) {
                void save(profiles.filter((p) => p.id !== active.id));
                setPrefs({ ...prefs, profileId: BUILT_IN_ID });
              }
              setConfirmDelete(false);
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </Panel>
  );
}
