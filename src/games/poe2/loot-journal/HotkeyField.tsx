/**
 * "Set shortcut" field: press a key combination, see it, then save or cancel. Validation happens in Rust
 * (`loot_hotkey_problem`, and clashes on save); this component only records what was pressed.
 * Keyboard only — the global-shortcut plugin can't register mouse buttons.
 */
import { useEffect, useRef, useState } from "react";
import { lootHotkeyProblem } from "@/core/ipc/commands";
import { Button, Kbd } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight"]);

/** "Ctrl+Shift+S" from a keydown, or null while only modifiers are held. Uses physical keys (layout-independent). */
export function shortcutFromEvent(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code.startsWith("Arrow") ? e.code.slice(5) : e.code;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  return [...mods, key].join("+");
}

export function HotkeyField({
  label,
  description,
  value,
  defaultValue,
  status,
  onSave,
}: {
  label: string;
  description?: string;
  /** "" = off */
  value: string;
  defaultValue: string;
  /** Registration state while PoE 2 is focused, if known. */
  status?: { registered: boolean; error: string | null } | null;
  /** Rejects with a user-facing reason (e.g. a clash) — shown under the field. */
  onSave: (key: string) => Promise<void>;
}) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        setPending(null);
        setProblem(null);
        return;
      }
      const s = shortcutFromEvent(e);
      if (!s) return;
      setPending(s);
      setRecording(false);
      void lootHotkeyProblem("poe2", s).then(setProblem, () => setProblem(null));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  const save = async (key: string) => {
    setSaving(true);
    try {
      await onSave(key);
      setPending(null);
      setProblem(null);
    } catch (e) {
      setProblem(String(e));
    } finally {
      setSaving(false);
    }
  };
  const shown = pending ?? value;

  return (
    <div ref={box} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        {status && value && pending === null && (
          <span className={cn("text-2xs", status.registered ? "text-success" : "text-warning")}>{status.registered ? "active in game" : (status.error ?? "not registered")}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "well flex h-8 min-w-36 items-center gap-1.5 rounded-md px-2.5 text-xs",
            recording ? "border-accent/60 text-accent-2" : pending !== null ? "border-accent/35" : "",
          )}
          aria-live="polite"
        >
          {recording ? (
            <>
              <Icon name="cursor" size={12} /> Press keys… (Esc cancels)
            </>
          ) : shown ? (
            <Kbd>{shown}</Kbd>
          ) : (
            <span className="text-fg-subtle">Off</span>
          )}
        </span>
        {pending !== null ? (
          <>
            <Button size="sm" variant="primary" loading={saving} disabled={!!problem} onClick={() => void save(pending)}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setPending(null), setProblem(null))}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => (setProblem(null), setRecording(true))} disabled={recording}>
              Set shortcut
            </Button>
            {value !== defaultValue && (
              <Button size="sm" variant="ghost" onClick={() => void save(defaultValue)}>
                {defaultValue ? `Default (${defaultValue})` : "Default (off)"}
              </Button>
            )}
            {value && defaultValue && (
              <Button size="sm" variant="ghost" onClick={() => void save("")}>
                Turn off
              </Button>
            )}
          </>
        )}
      </div>
      {problem && <p className="text-2xs text-warning">{problem}</p>}
      {description && !problem && <p className="text-2xs leading-relaxed text-fg-subtle">{description}</p>}
    </div>
  );
}
