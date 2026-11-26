import { useMemo, useState } from "react";
import { regexDelete, regexSave, regexSetFavorite, type RegexEntry } from "@/core/ipc/commands";
import { Badge, Button, Input, Panel, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { LIBRARY_CATEGORIES } from "./categories";
import { ConfirmDialog } from "./dialogs";
import { filterEntries, freeName, newId, type SortKey } from "./library";

export function LibraryPanel({
  entries,
  error,
  onLoad,
  onCopy,
  onEdit,
  onChanged,
  onExport,
  onToSlot,
}: {
  entries: RegexEntry[];
  error: string | null;
  onLoad: (e: RegexEntry) => void;
  onCopy: (e: RegexEntry) => void;
  onEdit: (e: RegexEntry) => void;
  onChanged: () => void;
  onExport: (entries: RegexEntry[]) => void;
  onToSlot: (e: RegexEntry, slot: number) => void;
}) {
  const notify = useToast();
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [sort, setSort] = useState<SortKey>("updated");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<RegexEntry | null>(null);
  const [slotFor, setSlotFor] = useState<string | null>(null);

  const cats = useMemo(() => [...new Set([...LIBRARY_CATEGORIES, ...entries.map((e) => e.category)])], [entries]);
  const tags = useMemo(() => [...new Set(entries.flatMap((e) => e.tags.map((t) => t.toLowerCase())))].sort(), [entries]);
  const shown = filterEntries(entries, { text, category: category || null, favorites, tag: tag || null, sort });
  const groups = cats.map((c) => [c, shown.filter((e) => e.category === c)] as const).filter(([, l]) => l.length);

  const act = async (f: () => Promise<unknown>, fail: string) => {
    try {
      await f();
      onChanged();
    } catch (e) {
      notify("error", fail, String(e));
    }
  };
  const duplicate = (e: RegexEntry) =>
    act(async () => {
      const name = freeName(e.name, new Set(entries.map((x) => x.name.toLowerCase())));
      await regexSave("poe1", { ...e, id: newId(), name, createdAt: 0, updatedAt: 0 }, false);
      notify("success", "Duplicated", name);
    }, "Couldn't duplicate");

  return (
    <Panel
      title={`Library (${entries.length})`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => onExport(shown)} disabled={!shown.length}>
          Export shown ({shown.length})
        </Button>
      }
    >
      {error && <p className="mb-2 text-sm text-danger">Couldn't read the library: {error}</p>}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input size="sm" icon="search" placeholder="Search name, regex, tags" value={text} onChange={(e) => setText(e.target.value)} containerClassName="flex-1 min-w-56" />
        <Select size="sm" label="Category" value={category} onChange={setCategory} options={[{ value: "", label: "All" }, ...cats.map((c) => ({ value: c, label: c }))]} />
        {tags.length > 0 && <Select size="sm" label="Tag" value={tag} onChange={setTag} options={[{ value: "", label: "Any" }, ...tags.map((t) => ({ value: t, label: t }))]} />}
        <Select
          size="sm"
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "updated", label: "Last changed" },
            { value: "created", label: "Newest" },
            { value: "name", label: "A–Z" },
          ]}
        />
        <Button size="sm" icon="star" variant={favorites ? "secondary" : "ghost"} aria-pressed={favorites} onClick={() => setFavorites((v) => !v)}>
          Favorites
        </Button>
      </div>

      {!entries.length ? (
        <p className="py-6 text-center text-sm text-fg-subtle">Your library is empty. Build or type a string above and press “Save to library”.</p>
      ) : !shown.length ? (
        <p className="py-6 text-center text-sm text-fg-subtle">No entries match the filters.</p>
      ) : (
        <div className="grid max-h-[560px] gap-2 overflow-auto pr-1">
          {groups.map(([c, list]) => {
            const closed = collapsed.has(c);
            return (
              <section key={c} className="rounded-lg border border-line bg-bg-2">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                  aria-expanded={!closed}
                  onClick={() => setCollapsed((s) => (closed ? new Set([...s].filter((x) => x !== c)) : new Set(s).add(c)))}
                >
                  <Icon name={closed ? "chevronRight" : "chevronDown"} size={14} />
                  <span className="font-medium">{c}</span>
                  <span className="text-xs text-fg-subtle">{list.length}</span>
                  {!(LIBRARY_CATEGORIES as readonly string[]).includes(c) && <Badge>folder</Badge>}
                </button>
                {!closed && (
                  <ul>
                    {list.map((e) => (
                      <li key={e.id} className="grid gap-1 border-t border-line px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            aria-label={e.favorite ? `Unfavorite ${e.name}` : `Favorite ${e.name}`}
                            aria-pressed={e.favorite}
                            className={cn("shrink-0", e.favorite ? "text-accent" : "text-fg-subtle hover:text-fg")}
                            onClick={() => act(() => regexSetFavorite("poe1", e.id, !e.favorite), "Couldn't update")}
                          >
                            <Icon name="star" size={15} />
                          </button>
                          <span className="font-medium">{e.name}</span>
                          {e.tags.map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                          <span className="ml-auto flex flex-wrap gap-1">
                            <Button size="sm" variant="ghost" icon="copy" onClick={() => onCopy(e)}>
                              Copy
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onLoad(e)}>
                              Load
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onEdit(e)}>
                              Edit / rename
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => duplicate(e)}>
                              Duplicate
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setSlotFor(slotFor === e.id ? null : e.id)}>
                              Slot…
                            </Button>
                            <Button size="sm" variant="ghost" className="hover:text-danger" onClick={() => setDeleting(e)}>
                              Delete
                            </Button>
                          </span>
                        </div>
                        {slotFor === e.id && (
                          <div className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
                            Put in quick slot:
                            {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                              <button
                                key={n}
                                className="h-6 w-6 rounded-sm border border-line font-mono transition-colors duration-120 hover:border-copper hover:text-fg"
                                onClick={() => (onToSlot(e, n), setSlotFor(null))}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        )}
                        <code className="block truncate font-mono text-xs text-fg-muted" title={e.regex}>
                          {e.regex}
                        </code>
                        {(e.description || e.notes) && (
                          <p className="text-xs text-fg-subtle">
                            {e.description}
                            {e.description && e.notes ? " · " : ""}
                            {e.notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete “${deleting.name}”?`}
          body="It is removed from your library. Quick slots keep their own copy of the string."
          confirm="Delete"
          onConfirm={() => act(() => regexDelete("poe1", deleting.id), "Couldn't delete")}
          onClose={() => setDeleting(null)}
        />
      )}
    </Panel>
  );
}
