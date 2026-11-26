/** Official patch notes and announcements: discovered articles, deterministic analysis, impact on Vaalytics. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { updatesArticles, updatesProcessArticle, updatesSetArticleReviewed, type UpdArticle } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { Badge, Button, EmptyState, Panel, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { ConfidenceBadge, GameTag, moduleLabel, Time } from "./ui";

const KIND_LABEL: Record<UpdArticle["kind"], string> = { patch_notes: "Patch notes", hotfix: "Hotfix", announcement: "Announcement", news: "News" };
const ACTION: Record<"data" | "developer" | "info", { label: string; tone: "success" | "warning" | "neutral" }> = {
  data: { label: "Data update", tone: "success" },
  developer: { label: "Needs developer implementation", tone: "warning" },
  info: { label: "Information only", tone: "neutral" },
};

export function PatchNotesTab({ uc, onRun, running }: { uc: UpdateCenter; onRun: () => void; running: boolean }) {
  const toast = useToast();
  const [list, setList] = useState<UpdArticle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<"all" | "poe1" | "poe2" | "unknown">("all");
  const [kind, setKind] = useState<"all" | UpdArticle["kind"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    updatesArticles(300)
      .then((a) => {
        setList(a);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => void load(), [uc.revision]);

  const shown = useMemo(
    () => (list ?? []).filter((a) => (game === "all" || (game === "unknown" ? a.game == null : a.game === game)) && (kind === "all" || a.kind === kind)),
    [list, game, kind],
  );

  const analyse = (a: UpdArticle) => {
    setBusy(a.articleId);
    updatesProcessArticle(a.providerId, a.articleId)
      .then(() => {
        setOpen(`${a.providerId}/${a.articleId}`);
        return load();
      })
      .catch((e) => toast("error", "Couldn't analyse the article", String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-xs leading-relaxed text-fg-muted">
          Official articles from pathofexile.com (patch-notes forums for each game and the news feed). New patch notes from the last 30 days are read automatically during a check
          — at most three per game each time — and classified with fixed keyword rules. <b className="text-fg">Patch notes are information:</b> nothing here changes installed data or
          Vaalytics itself. Where a change needs new application logic or bundled data, it is marked “Needs developer implementation”.
        </p>
      </Panel>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Game"
          size="sm"
          value={game}
          onChange={setGame}
          options={[
            { value: "all", label: "Both games" },
            { value: "poe1", label: "PoE 1" },
            { value: "poe2", label: "PoE 2" },
            { value: "unknown", label: "Game not stated" },
          ]}
        />
        <Select
          label="Type"
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "All" },
            { value: "patch_notes", label: "Patch notes" },
            { value: "hotfix", label: "Hotfixes" },
            { value: "announcement", label: "Announcements" },
            { value: "news", label: "News" },
          ]}
        />
      </div>
      {error ? (
        <EmptyState icon="error" title="Couldn't load articles" body={error} />
      ) : !list ? (
        <EmptyState icon="refresh" title="Loading…" loading />
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon="journal"
            title="No official articles yet"
            body="Check for updates to discover patch notes and announcements."
            action={
              <Button size="sm" icon="refresh" disabled={running} onClick={onRun}>
                Check for updates
              </Button>
            }
          />
        </Panel>
      ) : (
        <Panel flush>
          <ul className="divide-y divide-line">
            {shown.map((a) => {
              const key = `${a.providerId}/${a.articleId}`;
              const isOpen = open === key;
              return (
                <li key={key} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                      <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={14} className="shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{a.title}</span>
                        <span className="block text-xs text-fg-subtle">
                          {KIND_LABEL[a.kind]} · {a.publishedAt ? <Time ts={a.publishedAt} /> : <>found <Time ts={a.discoveredAt} /></>}
                          {a.analysis && ` · ${a.analysis.classifiedLines} of ${a.analysis.totalLines} lines classified`}
                          {a.processError && <span className="text-danger"> · {a.processError}</span>}
                        </span>
                      </span>
                    </button>
                    <GameTag game={a.game} />
                    {a.analysis?.impacts.some((i) => i.action === "developer") && <Badge tone="warning">Developer review</Badge>}
                    {a.analysis?.impacts.some((i) => i.action === "data") && <Badge tone="success">Data update</Badge>}
                    {a.reviewed && <Badge tone="info">Reviewed</Badge>}
                    {!a.analysis && (
                      <Button size="sm" variant="secondary" loading={busy === a.articleId} disabled={busy != null} onClick={() => analyse(a)}>
                        Analyse
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon="external" onClick={() => void openUrl(a.url).catch(() => {})}>
                      Original
                    </Button>
                  </div>
                  {isOpen && <ArticleDetail a={a} onReviewed={() => updatesSetArticleReviewed(a.providerId, a.articleId, !a.reviewed).then(load)} />}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ArticleDetail({ a, onReviewed }: { a: UpdArticle; onReviewed: () => void }) {
  const an = a.analysis;
  if (!an) return <p className="mt-2 ml-7 text-xs text-fg-subtle">Not analysed yet. “Analyse” reads the first post of the thread once.</p>;
  return (
    <div className="mt-3 ml-7 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
        {an.patch && <Badge tone="accent">Patch {an.patch}</Badge>}
        <span>Classifier: {an.classifier} · confidence depends on how specific the matched terms are.</span>
        <Button size="sm" variant="ghost" icon="check" className="ml-auto" onClick={onReviewed}>
          {a.reviewed ? "Mark unreviewed" : "Mark reviewed"}
        </Button>
      </div>
      {an.impacts.length === 0 ? (
        <p className="text-xs text-fg-subtle">No line matched a known category.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th className="py-1 font-medium">Category</th>
              <th className="py-1 font-medium">Lines</th>
              <th className="py-1 font-medium">Affected modules</th>
              <th className="py-1 font-medium">What it means</th>
              <th className="py-1 font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {an.impacts.map((i) => (
              <tr key={i.category}>
                <td className="py-1.5 pr-3 text-fg capitalize">{i.category}</td>
                <td className="tabular py-1.5 pr-3 text-fg-muted">{i.lines}</td>
                <td className="py-1.5 pr-3 text-fg-muted">{i.modules.map(moduleLabel).join(", ") || "—"}</td>
                <td className="py-1.5 pr-3">
                  <Badge tone={ACTION[i.action].tone}>{ACTION[i.action].label}</Badge>
                  {i.action !== "info" && <p className="mt-1 text-fg-subtle">{i.recommendation}</p>}
                  {i.examples.map((e, k) => (
                    <p key={k} className="mt-0.5 text-fg-muted">
                      “{e}”
                    </p>
                  ))}
                </td>
                <td className="py-1.5">
                  <ConfidenceBadge c={i.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-fg-subtle">All classified lines by section</summary>
        <div className="mt-2 space-y-3">
          {an.sections.map((s, k) => (
            <div key={k}>
              {s.title && <p className="font-medium text-fg">{s.title}</p>}
              <ul className="mt-1 space-y-0.5">
                {s.lines
                  .filter((l) => l.categories.length > 0)
                  .map((l, j) => (
                    <li key={j} className="text-fg-muted">
                      {l.text} <span className="text-fg-subtle">[{l.categories.join(", ")}]</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
