/**
 * A* and Dijkstra on the 8-neighbor grid (SPECIFICATION.md §4.4):
 * - A* heuristic = minimal unit cost x straight-line distance, admissible (multiplier 1);
 * - Dijkstra is kept as the small-graph cross-check (R1: same minimal cost);
 * - deterministic tie-breaking for reproducibility.
 */

import { edgeMetrics, minUnitCost } from "./graph.js";
import type { EdgeCostModel, SearchGraph } from "./graph.js";

export interface SearchResult {
  found: boolean;
  cost: number;
  path: Array<[number, number]> | null;
  expanded: number;
  measuredMs: number;
}

export class MinHeap {
  private keys: number[] = [];
  private tie: number[] = [];
  private nodes: number[] = [];
  private counter = 0;

  get size(): number {
    return this.keys.length;
  }

  push(key: number, node: number): void {
    this.keys.push(key);
    this.tie.push(this.counter++);
    this.nodes.push(node);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else break;
    }
  }

  pop(): number | undefined {
    if (this.keys.length === 0) return undefined;
    const top = this.nodes[0];
    const lastK = this.keys.pop() as number;
    const lastT = this.tie.pop() as number;
    const lastN = this.nodes.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastK;
      this.tie[0] = lastT;
      this.nodes[0] = lastN;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    const ki = this.keys[i] as number;
    const kj = this.keys[j] as number;
    if (ki !== kj) return ki < kj;
    return (this.tie[i] as number) < (this.tie[j] as number);
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i] as number;
    this.keys[i] = this.keys[j] as number;
    this.keys[j] = k;
    const t = this.tie[i] as number;
    this.tie[i] = this.tie[j] as number;
    this.tie[j] = t;
    const n = this.nodes[i] as number;
    this.nodes[i] = this.nodes[j] as number;
    this.nodes[j] = n;
  }
}

export const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

function straightLineM(graph: SearchGraph, a: number, b: number): number {
  const w = graph.width;
  const dr = Math.floor(a / w) - Math.floor(b / w);
  const dc = (a % w) - (b % w);
  return graph.cellSizeM * Math.hypot(dr, dc);
}

interface SearchCommon {
  graph: SearchGraph;
  startIdx: number;
  goalIdx: number;
  model: EdgeCostModel;
}

function runSearch(common: SearchCommon, useHeuristic: boolean): SearchResult {
  const t0 = performance.now();
  const { graph, startIdx, goalIdx, model } = common;
  const n = graph.width * graph.height;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const heap = new MinHeap();
  const unit = minUnitCost(model);
  dist[startIdx] = 0;
  const h0 = useHeuristic ? straightLineM(graph, startIdx, goalIdx) * unit : 0;
  heap.push(h0, startIdx);
  let expanded = 0;

  while (heap.size > 0) {
    const node = heap.pop() as number;
    if (settled[node] === 1) continue;
    settled[node] = 1;
    expanded++;
    if (node === goalIdx) break;
    const row = Math.floor(node / graph.width);
    const col = node % graph.width;
    for (const [dr, dc] of NEIGHBORS) {
      const r2 = row + dr;
      const c2 = col + dc;
      if (r2 < 0 || r2 >= graph.height || c2 < 0 || c2 >= graph.width) continue;
      const idx2 = r2 * graph.width + c2;
      if (settled[idx2] === 1) continue;
      const m = edgeMetrics(graph, row, col, r2, c2, model);
      if (m === null) continue;
      const nd = (dist[node] as number) + m.cost;
      if (nd < (dist[idx2] as number)) {
        dist[idx2] = nd;
        prev[idx2] = node;
        const h = useHeuristic ? straightLineM(graph, idx2, goalIdx) * unit : 0;
        heap.push(nd + h, idx2);
      }
    }
  }

  const measuredMs = performance.now() - t0;
  if ((dist[goalIdx] as number) === Infinity) {
    return { found: false, cost: Infinity, path: null, expanded, measuredMs };
  }
  const path: Array<[number, number]> = [];
  let cur = goalIdx;
  while (cur !== -1) {
    path.push([Math.floor(cur / graph.width), cur % graph.width]);
    if (cur === startIdx) break;
    cur = prev[cur] as number;
  }
  path.reverse();
  return { found: true, cost: dist[goalIdx] as number, path, expanded, measuredMs };
}

export function dijkstra(
  graph: SearchGraph,
  startRow: number,
  startCol: number,
  goalRow: number,
  goalCol: number,
  model: EdgeCostModel,
): SearchResult {
  const w = graph.width;
  return runSearch(
    { graph, startIdx: startRow * w + startCol, goalIdx: goalRow * w + goalCol, model },
    false,
  );
}

export function astar(
  graph: SearchGraph,
  startRow: number,
  startCol: number,
  goalRow: number,
  goalCol: number,
  model: EdgeCostModel,
): SearchResult {
  const w = graph.width;
  return runSearch(
    { graph, startIdx: startRow * w + startCol, goalIdx: goalRow * w + goalCol, model },
    true,
  );
}
