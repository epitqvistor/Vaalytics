/**
 * Deterministic layered layout for small graphs (schematic maps): nodes are put
 * in columns by walking distance from a root, and ordered inside each column by
 * the average row of their neighbours (a few sweeps reduce crossings). The result
 * is topology, not geography — the UI must say so. Pure, game-agnostic.
 */

export interface LayoutInput {
  /** Node ids in a stable order (used to break ties). */
  nodes: string[];
  /** Undirected adjacency for placement (direction is drawn separately). */
  links: [string, string][];
  root: string;
}

export interface LayoutNode {
  id: string;
  /** Column (walking distance from the root; unreachable nodes go after the last column). */
  depth: number;
  /** Row inside the column. */
  row: number;
  /** Normalised position, 0–1 on both axes (resolution-independent). */
  x: number;
  y: number;
}

export interface Layout {
  nodes: Map<string, LayoutNode>;
  columns: number;
  /** Most nodes in one column. */
  rows: number;
}

export function layeredLayout({ nodes, links, root }: LayoutInput): Layout {
  const order = new Map(nodes.map((n, i) => [n, i]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of links) {
    if (!adj.has(a) || !adj.has(b) || a === b) continue;
    if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
    if (!adj.get(b)!.includes(a)) adj.get(b)!.push(a);
  }
  for (const list of adj.values()) list.sort((x, y) => order.get(x)! - order.get(y)!);

  // Columns by BFS distance from the root.
  const depth = new Map<string, number>();
  const start = adj.has(root) ? root : nodes[0];
  if (start !== undefined) {
    depth.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const n of adj.get(id)!) {
        if (!depth.has(n)) {
          depth.set(n, depth.get(id)! + 1);
          queue.push(n);
        }
      }
    }
  }
  const maxReached = Math.max(0, ...depth.values());
  let extra = maxReached + 1;
  for (const n of nodes) if (!depth.has(n)) depth.set(n, extra++); // disconnected pieces: own columns

  const columns: string[][] = [];
  for (const n of nodes) (columns[depth.get(n)!] ??= []).push(n);
  for (let i = 0; i < columns.length; i++) columns[i] ??= [];

  // Barycentre ordering: sweep left→right, then right→left.
  const row = new Map<string, number>();
  const assign = (col: string[]) => col.forEach((n, i) => row.set(n, i));
  columns.forEach(assign);
  const bary = (n: string, neighbourCol: number) => {
    const ns = adj.get(n)!.filter((m) => depth.get(m) === neighbourCol);
    return ns.length ? ns.reduce((s, m) => s + row.get(m)!, 0) / ns.length : row.get(n)!;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const range = forward ? columns.map((_, i) => i).slice(1) : columns.map((_, i) => i).slice(0, -1).reverse();
    for (const c of range) {
      const ref = forward ? c - 1 : c + 1;
      columns[c]!.sort((a, b) => bary(a, ref) - bary(b, ref) || order.get(a)! - order.get(b)!);
      assign(columns[c]!);
    }
  }

  const rows = Math.max(1, ...columns.map((c) => c.length));
  const out = new Map<string, LayoutNode>();
  const cols = columns.length;
  columns.forEach((col, c) => {
    col.forEach((id, r) => {
      // Centre short columns vertically against the tallest one.
      const offset = (rows - col.length) / 2;
      out.set(id, {
        id,
        depth: c,
        row: r,
        x: cols === 1 ? 0.5 : c / (cols - 1),
        y: rows === 1 ? 0.5 : (r + offset) / (rows - 1),
      });
    });
  });
  return { nodes: out, columns: cols, rows };
}
