/**
 * Development-only gallery of design-system primitives (Settings → Design system,
 * dev builds only). Used for visual QA; contains no product data.
 */
import { useState } from "react";
import { Badge, Button, IconButton, Input, Kbd, Modal, Panel, SegmentedControl, Switch } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { ICONS, type IconName } from "@/shared/icons/icons";

const SWATCHES = [
  ["bg", "bg-bg"],
  ["bg-2", "bg-bg-2"],
  ["surface", "bg-surface"],
  ["elevated", "bg-elevated"],
  ["elevated-2", "bg-elevated-2"],
  ["accent", "bg-accent"],
  ["accent-2", "bg-accent-2"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
  ["info", "bg-info"],
] as const;

const TYPE = [
  ["2xl · display", "font-display text-2xl font-semibold tracking-tight"],
  ["xl · page title", "font-display text-xl font-semibold tracking-tight"],
  ["lg · modal title", "text-lg font-semibold"],
  ["base · body", "text-base"],
  ["sm · UI default", "text-sm"],
  ["xs · secondary", "text-xs text-fg-muted"],
  ["2xs · labels", "text-2xs font-medium tracking-wide text-fg-subtle uppercase"],
] as const;

export default function DesignGallery() {
  const [modal, setModal] = useState(false);
  const [sw, setSw] = useState(true);
  const [seg, setSeg] = useState<"low" | "new" | "match">("low");

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Colour">
        <div className="grid grid-cols-6 gap-3">
          {SWATCHES.map(([name, cls]) => (
            <div key={name}>
              <div className={`h-10 rounded-md border border-line ${cls}`} />
              <div className="mt-1.5 text-2xs text-fg-muted">{name}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Typography">
        <div className="flex flex-col gap-2.5">
          {TYPE.map(([label, cls]) => (
            <div key={label} className="flex items-baseline gap-4">
              <span className="w-32 shrink-0 text-2xs text-fg-subtle">{label}</span>
              <span className={cls}>Mirror of Kalandra 1,240.5</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4">
            <span className="w-32 shrink-0 text-2xs text-fg-subtle">mono · numbers</span>
            <span className="tabular text-sm">0123456789 · 12.5 div</span>
          </div>
        </div>
      </Panel>

      <Panel title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon="priceCheck">
            Primary
          </Button>
          <Button icon="refresh">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" iconRight="external">
            Small
          </Button>
          <IconButton icon="star" label="Favourite" />
          <IconButton icon="copy" label="Copy" variant="secondary" size="sm" />
        </div>
      </Panel>

      <Panel title="Inputs & controls">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Search" icon="search" placeholder="Search items" suffix={<Kbd>Ctrl K</Kbd>} />
          <Input label="Max price" placeholder="0" suffix="chaos" hint="Inclusive upper bound" />
          <Input label="Invalid" defaultValue="abc" error="Enter a number" />
          <Input label="Disabled" disabled placeholder="Unavailable" />
        </div>
        <div className="mt-5 flex items-center justify-between gap-6">
          <SegmentedControl
            label="Sort"
            value={seg}
            onChange={setSeg}
            segments={[
              { value: "low", label: "Lowest" },
              { value: "new", label: "Newest" },
              { value: "match", label: "Best match" },
            ]}
          />
          <div className="w-72">
            <Switch label="Online sellers only" checked={sw} onChange={setSw} />
          </div>
        </div>
      </Panel>

      <Panel title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Estimate</Badge>
          <Badge tone="success" dot>
            Online
          </Badge>
          <Badge tone="warning" dot>
            AFK
          </Badge>
          <Badge tone="danger">Corrupted</Badge>
          <Badge tone="info">Sample data</Badge>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-5">
        <Panel title="Glass surface" surface="glass">
          <p className="text-sm text-fg-muted">For navigation and chrome. Not for dense data.</p>
        </Panel>
        <Panel title="Solid panel">
          <p className="text-sm text-fg-muted">For prices, tables and listings.</p>
        </Panel>
      </div>

      <Panel title={`Icons (${Object.keys(ICONS).length})`}>
        <div className="grid grid-cols-10 gap-2">
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <div key={name} title={name} className="flex flex-col items-center gap-1.5 rounded-md py-2.5 text-fg-muted hover:bg-glass-hover hover:text-fg">
              <Icon name={name} size={18} />
              <span className="max-w-full truncate px-1 text-[10px] text-fg-subtle">{name}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Modal">
        <Button onClick={() => setModal(true)}>Open modal</Button>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Change executable path"
          description="Select the Path of Building executable to launch from Vaalytics."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setModal(false)}>
                Save
              </Button>
            </>
          }
        >
          <Input label="Executable" placeholder="C:\\…\\Path of Building.exe" />
        </Modal>
      </Panel>
    </div>
  );
}
