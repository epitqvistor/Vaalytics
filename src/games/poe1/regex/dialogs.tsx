import { useEffect, useMemo, useState } from "react";
import { regexSave, type RegexEntry } from "@/core/ipc/commands";
import { Badge, Button, Checkbox, Input, Modal, SegmentedControl, Select, useToast } from "@/shared/components";
import { LIBRARY_CATEGORIES } from "./categories";
import { type DuplicateAction, type ImportParse, planImport, newId } from "./library";

const NEW_FOLDER = "__new__";

export interface SaveDraft {
  id: string | null;
  name: string;
  category: string;
  regex: string;
  description: string;
  tags: string[];
  notes: string;
  favorite: boolean;
  createdAt?: number;
}

/** Save / edit / rename. A name used by another entry asks: rename or overwrite. */
export function SaveDialog({
  draft,
  categories,
  onClose,
  onSaved,
}: {
  draft: SaveDraft | null;
  categories: string[];
  onClose: () => void;
  onSaved: (e: RegexEntry) => void;
}) {
  const notify = useToast();
  const [d, setD] = useState<SaveDraft | null>(draft);
  const [tags, setTags] = useState("");
  const [folder, setFolder] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setD(draft);
    setTags(draft?.tags.join(", ") ?? "");
    setFolder("");
    setConflict(false);
  }, [draft]);

  const allCats = useMemo(() => [...new Set([...LIBRARY_CATEGORIES, ...categories, ...(draft ? [draft.category] : [])])], [categories, draft]);
  if (!d) return null;
  const category = d.category === NEW_FOLDER ? folder.trim() : d.category;
  const missing = !d.name.trim() ? "Name is required." : !category ? "Category is required." : !d.regex.trim() ? "Regex is required." : null;

  const save = async (overwrite: boolean) => {
    if (missing) return;
    setBusy(true);
    try {
      const entry: RegexEntry = {
        id: d.id ?? newId(),
        name: d.name.trim(),
        category,
        regex: d.regex,
        description: d.description,
        notes: d.notes,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        favorite: d.favorite,
        createdAt: d.createdAt ?? 0,
        updatedAt: 0,
      };
      const out = await regexSave("poe1", entry, overwrite);
      if (out.status === "nameTaken") setConflict(true);
      else {
        onSaved(out.entry);
        onClose();
      }
    } catch (e) {
      notify("error", "Couldn't save", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={d.id ? "Edit regex" : "Save to library"}
      size="lg"
      footer={
        conflict ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span className="mr-auto text-sm text-warning">A regex named “{d.name.trim()}” already exists.</span>
            <Button variant="ghost" onClick={() => setConflict(false)}>
              Rename
            </Button>
            <Button variant="danger" loading={busy} onClick={() => save(true)}>
              Overwrite it
            </Button>
          </div>
        ) : (
          <div className="flex w-full items-center gap-2">
            {missing && <span className="mr-auto text-xs text-fg-subtle">{missing}</span>}
            <Button variant="ghost" onClick={onClose} className="ml-auto">
              Cancel
            </Button>
            <Button variant="primary" disabled={!!missing} loading={busy} onClick={() => save(false)}>
              Save
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name *" value={d.name} maxLength={80} autoFocus onChange={(e) => (setD({ ...d, name: e.target.value }), setConflict(false))} />
        <div className="flex items-end gap-2">
          <Select
            label="Category / folder *"
            className="flex-1"
            value={d.category}
            onChange={(v) => setD({ ...d, category: v })}
            options={[...allCats.map((c) => ({ value: c, label: c })), { value: NEW_FOLDER, label: "New folder…" }]}
          />
          {d.category === NEW_FOLDER && <Input aria-label="Folder name" placeholder="Folder name" value={folder} maxLength={80} onChange={(e) => setFolder(e.target.value)} />}
        </div>
        <label className="sm:col-span-2 grid gap-1 text-xs text-fg-muted">
          Regex *
          <textarea
            className="min-h-20 rounded-md border border-line bg-bg-2 p-2 font-mono text-sm text-fg"
            value={d.regex}
            spellCheck={false}
            onChange={(e) => setD({ ...d, regex: e.target.value })}
          />
        </label>
        <Input label="Description" value={d.description} maxLength={4000} onChange={(e) => setD({ ...d, description: e.target.value })} />
        <Input label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
        <label className="sm:col-span-2 grid gap-1 text-xs text-fg-muted">
          Notes
          <textarea className="min-h-14 rounded-md border border-line bg-bg-2 p-2 text-sm text-fg" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </label>
        <Checkbox checked={d.favorite} onChange={(v) => setD({ ...d, favorite: v })} label="Favorite" />
      </div>
    </Modal>
  );
}

/** Import preview: what's new, what collides, and how to handle collisions. */
export function ImportDialog({
  parsed,
  existing,
  onClose,
  onDone,
}: {
  parsed: ImportParse | null;
  existing: RegexEntry[];
  onClose: () => void;
  onDone: (summary: string) => void;
}) {
  const notify = useToast();
  const [action, setAction] = useState<DuplicateAction>("merge");
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAction("merge");
    setReplace(new Set());
  }, [parsed]);
  const dupes = useMemo(() => {
    const names = new Set(existing.map((e) => e.name.toLowerCase()));
    return parsed?.entries.filter((e) => names.has(e.name.toLowerCase())) ?? [];
  }, [parsed, existing]);
  if (!parsed) return null;
  const plan = planImport(existing, parsed.entries, action, replace);

  const run = async () => {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    const save = async (id: string, e: (typeof parsed.entries)[number]) => {
      try {
        const out = await regexSave("poe1", { ...e, id, createdAt: 0, updatedAt: 0 }, false);
        if (out.status === "saved") ok++;
        else failed.push(e.name);
      } catch {
        failed.push(e.name);
      }
    };
    for (const e of [...plan.add, ...plan.renamed]) await save(newId(), e);
    for (const r of plan.replace) await save(r.existingId, r.entry);
    setBusy(false);
    if (failed.length) notify("warning", "Some entries weren't imported", failed.slice(0, 5).join(", "));
    onDone(`Imported ${ok} · skipped ${plan.skipped.length}${failed.length ? ` · failed ${failed.length}` : ""}`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Import regex library"
      description="Imports add to your library. Nothing is replaced unless you pick it below."
      size="lg"
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="mr-auto text-xs text-fg-subtle">
            {plan.add.length} new · {plan.renamed.length} renamed · {plan.replace.length} replaced · {plan.skipped.length} skipped
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!plan.add.length && !plan.renamed.length && !plan.replace.length} onClick={run}>
            Import
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 text-sm">
        <p className="text-fg-muted">
          {parsed.entries.length} valid entr{parsed.entries.length === 1 ? "y" : "ies"} in the file.
          {parsed.rejected.length > 0 && <span className="text-warning"> {parsed.rejected.length} rejected.</span>}
        </p>
        {parsed.rejected.length > 0 && (
          <ul className="max-h-24 overflow-auto rounded-md bg-bg-2 p-2 text-xs text-fg-subtle">
            {parsed.rejected.map((r, i) => (
              <li key={i}>{r.index >= 0 ? `Row ${r.index + 1}: ` : ""}{r.reason}</li>
            ))}
          </ul>
        )}
        {dupes.length > 0 && (
          <>
            <SegmentedControl
              label="Same name as an existing entry"
              value={action}
              onChange={setAction}
              segments={[
                { value: "merge", label: "Keep both (rename)" },
                { value: "skip", label: "Skip" },
                { value: "replace", label: "Replace selected" },
              ]}
            />
            <ul className="max-h-56 overflow-auto rounded-md border border-line bg-bg-2">
              {dupes.map((e) => {
                const k = e.name.toLowerCase();
                return (
                  <li key={k} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-0">
                    {action === "replace" ? (
                      <Checkbox
                        checked={replace.has(k)}
                        onChange={(v) => setReplace((s) => (v ? new Set(s).add(k) : new Set([...s].filter((x) => x !== k))))}
                        label={e.name}
                      />
                    ) : (
                      <span>{e.name}</span>
                    )}
                    <Badge className="ml-auto">{action === "merge" ? "kept, renamed" : action === "skip" || !replace.has(k) ? "skipped" : "replaces existing"}</Badge>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

export function ConfirmDialog({ title, body, confirm, onConfirm, onClose }: { title: string; body: string; confirm: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirm}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-fg-muted">{body}</p>
    </Modal>
  );
}
