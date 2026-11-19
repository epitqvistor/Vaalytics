/**
 * Shortest path over a directed graph (Dijkstra, pure, game-agnostic). The graph is
 * given as a neighbour function so callers decide which moves exist (walking,
 * waypoints, …); the router never adds a move of its own. Ties break on node id,
 * so the same input always yields the same route.
 */

export interface RouteMove<K extends string = string> {
  to: string;
  /** What kind of move this is (e.g. "walk", "waypoint"); carried into the result. */
  kind: K;
  /** Non-negative cost of the move. */
  cost: number;
}

export interface RouteStep<K extends string = string> {
  from: string;
  to: string;
  kind: K;
}

export interface Route<K extends string = string> {
  /** Nodes in order, start first. */
  nodes: string[];
  steps: RouteStep<K>[];
  cost: number;
}

/**
 * Cheapest route from `start` to the first node that satisfies `isGoal` (the start
 * itself counts). `null` when no goal is reachable. `maxNodes` bounds the search.
 */
export function shortestRoute<K extends string>(
  start: string,
  isGoal: (id: string) => boolean,
  moves: (id: string) => readonly RouteMove<K>[],
  maxNodes = 10_000,
): Route<K> | null {
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { from: string; kind: K }>();
  const done = new Set<string>();
  // Small graphs (a few hundred nodes): a sorted frontier is simpler than a heap and fast enough.
  let frontier: string[] = [start];
  while (frontier.length && done.size < maxNodes) {
    frontier.sort((a, b) => dist.get(a)! - dist.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
    const id = frontier.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    if (isGoal(id)) return build(start, id, prev, dist.get(id)!);
    const d = dist.get(id)!;
    for (const m of moves(id)) {
      if (done.has(m.to) || !(m.cost >= 0)) continue;
      const nd = d + m.cost;
      const old = dist.get(m.to);
      if (old === undefined || nd < old) {
        dist.set(m.to, nd);
        prev.set(m.to, { from: id, kind: m.kind });
        if (old === undefined) frontier.push(m.to);
      }
    }
    frontier = frontier.filter((n) => !done.has(n));
  }
  return null;
}

function build<K extends string>(start: string, goal: string, prev: Map<string, { from: string; kind: K }>, cost: number): Route<K> {
  const steps: RouteStep<K>[] = [];
  let at = goal;
  while (at !== start) {
    const p = prev.get(at)!;
    steps.push({ from: p.from, to: at, kind: p.kind });
    at = p.from;
  }
  steps.reverse();
  return { nodes: [start, ...steps.map((s) => s.to)], steps, cost };
}
