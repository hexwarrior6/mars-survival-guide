/** Screen-space label collision pass.
 *
 * The 3D scene portals small HTML labels into the stage overlay; three site
 * labels plus the base label crowd the same patch of screen at overview range
 * (the selected site used to sit on top of the BASE label). This component
 * projects each label anchor once per frame and hides the lower-priority label
 * of any overlapping pair, so exactly one label survives a collision instead of
 * two half-readable ones. DOM only — no 3D geometry and no data involved.
 */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export interface LabelAnchor {
  id: string;
  /** world-space point the drei <Html> label is anchored to */
  x: number;
  y: number;
  z: number;
  /** lower wins: selected site 0, base 1, remaining sites 2+ */
  priority: number;
}

const PADDING_PX = 6;

export function LabelLayout({
  anchors,
  elements,
  obstacles,
}: {
  anchors: LabelAnchor[];
  elements: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  /** world points the labels must not sit on (the planned route) */
  obstacles?: THREE.Vector3[];
}): null {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const sizes = useRef(new Map<string, { w: number; h: number }>());
  const offsets = useRef(new Map<string, number>());
  const v = useMemo(() => new THREE.Vector3(), []);
  const ordered = useMemo(
    () => [...anchors].sort((a, b) => a.priority - b.priority),
    [anchors],
  );

  const obstacleStep = 4;

  useFrame(() => {
    const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const visible = new Map<string, boolean>();

    // the route is a fixed obstacle: labels move out of its way, never the
    // other way round — a chip covering the plan is worse than a shifted chip
    if (obstacles !== undefined) {
      const half = 9;
      for (let i = 0; i < obstacles.length; i += obstacleStep) {
        const p = obstacles[i] as THREE.Vector3;
        v.copy(p).project(camera);
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * size.width;
        const sy = (-v.y * 0.5 + 0.5) * size.height;
        boxes.push({ x0: sx - half, y0: sy - half, x1: sx + half, y1: sy + half });
      }
    }

    for (const a of ordered) {
      const el = elements.current.get(a.id) ?? null;
      if (el === null) continue;
      let dim = sizes.current.get(a.id);
      if (dim === undefined) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (w === 0 || h === 0) continue;
        dim = { w, h };
        sizes.current.set(a.id, dim);
      }
      v.set(a.x, a.y, a.z).project(camera);
      // behind the camera or outside the canvas: nothing to place
      if (v.z > 1 || Math.abs(v.x) > 1.4 || Math.abs(v.y) > 1.4) {
        visible.set(a.id, false);
        continue;
      }
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      // try the anchor position first, then step up / down by one label height
      // before giving up: a nudged label still reads as attached to its marker
      const shots = [0, -(dim.h + 10), dim.h + 10, -2 * (dim.h + 10), 2 * (dim.h + 10)];
      let chosen: number | null = null;
      for (const dy of shots) {
        const box = {
          x0: sx - dim.w / 2 - PADDING_PX,
          y0: sy + dy - dim.h / 2 - PADDING_PX,
          x1: sx + dim.w / 2 + PADDING_PX,
          y1: sy + dy + dim.h / 2 + PADDING_PX,
        };
        const clash = boxes.some(
          (b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
        );
        if (!clash) {
          chosen = dy;
          boxes.push(box);
          break;
        }
      }
      visible.set(a.id, chosen !== null);
      const nextOffset = chosen ?? 0;
      if (offsets.current.get(a.id) !== nextOffset) {
        offsets.current.set(a.id, nextOffset);
        el.style.transform = nextOffset === 0 ? "" : `translateY(${nextOffset}px)`;
      }
    }

    for (const a of ordered) {
      const el = elements.current.get(a.id) ?? null;
      if (el === null) continue;
      const show = visible.get(a.id) ?? true;
      el.style.visibility = show ? "" : "hidden";
    }
  });

  return null;
}
