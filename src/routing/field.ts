/**
 * Reverse Dijkstra cost field — the "returnable range" primitive
 * (SPECIFICATION.md §4, visual-revamp V3).
 *
 * For every cell it computes the minimum walk TIME (minutes, identical edge
 * model as planning) from that cell TO the base. Edge costs are
 * DIRECTION-SENSITIVE: the ascent penalty applies when the walk climbs, so the
 * relaxation costs each edge in the neighbour→settled direction. A symmetric
 * approximation would understate climb-out time and is explicitly forbidden.
 *
 * Determinism: the min-heap uses the same tie-breaking as the A-star and
 * Dijkstra searches in search.ts, so identical inputs produce identical fields.
 */

import { edgeMetrics, type EdgeCostModel, type SearchGraph } from "./graph.js";
import { MinHeap, NEIGHBORS } from "./search.js";

export interface CostField {
  /** minimum minutes from each cell (row-major) to the base; Infinity = cannot reach the base */
  readonly minutes: Float64Array;
  readonly baseRow: number;
  readonly baseCol: number;
}

export function costFieldToBase(
  graph: SearchGraph,
  baseRow: number,
  baseCol: number,
  model: EdgeCostModel,
): CostField {
  const w = graph.width;
  const n = w * graph.height;
  const minutes = new Float64Array(n).fill(Infinity);
  const settled = new Uint8Array(n);
  const heap = new MinHeap();
  const startIdx = baseRow * w + baseCol;
  minutes[startIdx] = 0;
  heap.push(0, startIdx);
  while (heap.size > 0) {
    const node = heap.pop() as number;
    if (settled[node] === 1) continue;
    settled[node] = 1;
    const row = Math.floor(node / w);
    const col = node % w;
    for (const [dr, dc] of NEIGHBORS) {
      const r2 = row + dr;
      const c2 = col + dc;
      if (r2 < 0 || r2 >= graph.height || c2 < 0 || c2 >= w) continue;
      const idx2 = r2 * w + c2;
      if (settled[idx2] === 1) continue;
      // cost of walking FROM the neighbour TO the settled cell (ascent penalty
      // in the real traversal direction — this is what makes the field a
      // return-cost field rather than a plain distance transform)
      const m = edgeMetrics(graph, r2, c2, row, col, model);
      if (m === null) continue;
      const nd = (minutes[node] as number) + m.minutes;
      if (nd < (minutes[idx2] as number)) {
        minutes[idx2] = nd;
        heap.push(nd, idx2);
      }
    }
  }
  return { minutes, baseRow, baseCol };
}
