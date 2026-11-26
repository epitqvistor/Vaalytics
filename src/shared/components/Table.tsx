import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

/**
 * Data table primitives: one set of rules for every table (header weight, row
 * height, numeric alignment, sort indicator, hover/selection). Plain <table>
 * semantics; no card-per-row, hairline separators only.
 *
 *   <Table><thead><tr><Th>Item</Th><Th numeric sort="desc" onSort={…}>Value</Th></tr></thead>
 *     <tbody><Tr><Td>…</Td><Td numeric>…</Td></Tr></tbody></Table>
 */
export function Table({ dense, className, children, ...rest }: HTMLAttributes<HTMLTableElement> & { dense?: boolean }) {
  return (
    <table data-dense={dense || undefined} className={cn("group/table w-full border-collapse text-sm", className)} {...rest}>
      {children}
    </table>
  );
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  /** Current sort of this column; omit when the column is not sorted. */
  sort?: "asc" | "desc" | null;
  /** Makes the header a sort button. */
  onSort?: () => void;
}

export function Th({ numeric, sort, onSort, className, children, ...rest }: ThProps) {
  const content = (
    <>
      {children}
      {sort && <Icon name={sort === "asc" ? "chevronUp" : "chevronDown"} size={12} className="text-accent-2" />}
    </>
  );
  return (
    <th
      scope="col"
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
      className={cn(
        "h-8 border-b border-line px-3 text-xs font-medium whitespace-nowrap text-fg-subtle first:pl-4 last:pr-4",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn("inline-flex items-center gap-1 transition-colors duration-120 hover:text-fg", sort && "text-fg-muted", numeric && "flex-row-reverse")}
        >
          {content}
        </button>
      ) : (
        <span className={cn("inline-flex items-center gap-1", numeric && "flex-row-reverse")}>{content}</span>
      )}
    </th>
  );
}

export function Tr({ selected, interactive, className, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-line transition-colors duration-100 last:border-b-0",
        selected ? "bg-accent-soft" : interactive !== false && "hover:bg-glass",
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ numeric, muted, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; muted?: boolean }) {
  return (
    <td
      className={cn(
        "h-9 px-3 align-middle first:pl-4 last:pr-4 group-data-[dense]/table:h-8",
        numeric && "tabular text-right whitespace-nowrap",
        muted ? "text-fg-muted" : "text-fg",
        className,
      )}
      {...rest}
    />
  );
}

/** Cell content: an item with icon and a name that truncates instead of wrapping. */
export function ItemCell({ icon, children, sub }: { icon?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {icon}
      <span className="min-w-0">
        <span className="block truncate">{children}</span>
        {sub && <span className="block truncate text-xs text-fg-subtle">{sub}</span>}
      </span>
    </span>
  );
}
