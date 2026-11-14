/** Undistorted 2D plan view (cross-check + fallback): ortho extract, routes,
 * markers, scale bar, north arrow. One canvas, redrawn on state change. */

import { useEffect, useRef } from "react";
import type { JSX } from "react";
import type { LoadedPackage } from "../domain/load.js";
import type { RouteResult, Strategy } from "../domain/types.js";
import type { MissionRuntime } from "../simulation/runtime.js";
import { worldTransform } from "../domain/world.js";
import { useLang } from "./i18n.js";

const SIZE = 720; // canvas pixels; region maps to SIZE x SIZE

export function PlanView2D({
  pkg,
  result,
  strategy,
  selectedSiteId,
  runtimeRef,
  redrawKey,
  astronaut,
}: {
  pkg: LoadedPackage;
  result: RouteResult | null;
  strategy: Strategy;
  selectedSiteId: string | null;
  runtimeRef: React.MutableRefObject<MissionRuntime | null>;
  redrawKey: number;
  astronaut: { xM: number; yM: number } | null;
}): JSX.Element {
  const { lang } = useLang();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = "/data/jezero/imagery/ortho_20m.jpg";
    const draw = (): void => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);

      const toPx = (xM: number, yM: number): [number, number] => [
        (xM / pkg.region.boundsLocalM.widthM) * SIZE,
        (1 - yM / pkg.region.boundsLocalM.heightM) * SIZE,
      ];
      const drawPath = (
        cells: Array<[number, number]>,
        color: string,
        width: number,
        dash: number[],
      ): void => {
        if (cells.length === 0) return;
        ctx.beginPath();
        cells.forEach(([r, c], i) => {
          const xM = (c + 0.5) * pkg.terrain.cellSizeM;
          const yM = pkg.terrain.originYM - (r + 0.5) * pkg.terrain.cellSizeM;
          const [px, py] = toPx(xM, yM);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      const candidate = result?.candidates.find((c) => c.strategy === strategy);
      const rt = runtimeRef.current;
      const emergencyActive = !!(rt !== null && rt.emergency !== null && rt.emergency.plan !== null);
      if (candidate) {
        const invalid = emergencyActive;
        drawPath(candidate.outbound.pathCells, invalid ? "#8a8078" : "#fff3dd", 3, invalid ? [6, 5] : []);
        drawPath(candidate.returnRoute.pathCells, invalid ? "#8a8078" : "#ffb45e", 2.5, invalid ? [6, 5] : [8, 6]);
      }
      if (rt !== null && rt.emergency !== null && rt.emergency.plan !== null) {
        const plan = rt.emergency.plan;
        const cs = pkg.terrain.cellSizeM;
        ctx.beginPath();
        plan.cells.forEach(([r, c], i) => {
          const xM = (c + 0.5) * cs;
          const yM = pkg.terrain.originYM - (r + 0.5) * cs;
          const [px, py] = toPx(xM, yM);
          if (i === 0) {
            // start from the exact event position
            const [sx, sy] = toPx(plan.startXM, plan.startYM);
            ctx.moveTo(sx, sy);
          }
          ctx.lineTo(px, py);
        });
        ctx.strokeStyle = "#ffb45e";
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.stroke();
        // closure rectangle
        const ev = pkg.scenario.events.find((e) => e.type === "area_closure");
        if (ev && ev.geometry.type === "rectangle") {
          const [r0, r1] = ev.geometry.rows;
          const [c0, c1] = ev.geometry.cols;
          const [x0, y0] = toPx(c0 * cs, pkg.terrain.originYM - r0 * cs);
          const [x1, y1] = toPx(c1 * cs, pkg.terrain.originYM - r1 * cs);
          ctx.strokeStyle = "#ff5c47";
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        }
      }

      // astronaut dot at the exact interpolated position
      if (astronaut !== null) {
        const [ax, ay] = toPx(astronaut.xM, astronaut.yM);
        ctx.beginPath();
        ctx.arc(ax, ay, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#ffb45e";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // sites and base
      for (const site of pkg.sites) {
        const [px, py] = toPx(site.xM, site.yM);
        ctx.beginPath();
        ctx.arc(px, py, selectedSiteId === site.id ? 9 : 6, 0, Math.PI * 2);
        ctx.strokeStyle = selectedSiteId === site.id ? "#ffb45e" : "#f5ead9";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#f5ead9";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText(site.id, px + 10, py - 6);
      }
      const [bx, by] = toPx(pkg.scenario.base.xM, pkg.scenario.base.yM);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bx - 4, by - 4, 8, 8);
      ctx.fillStyle = "#f5ead9";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(lang === "zh" ? "基地（模拟）" : "BASE (sim)", bx + 8, by + 4);

      // scale bar: 500 m
      const barPx = (500 / pkg.region.boundsLocalM.widthM) * SIZE;
      ctx.strokeStyle = "#f5ead9";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(SIZE - 30 - barPx, SIZE - 24);
      ctx.lineTo(SIZE - 30, SIZE - 24);
      ctx.stroke();
      ctx.fillStyle = "#f5ead9";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("500 m", SIZE - 30 - barPx, SIZE - 30);

      // north arrow
      ctx.strokeStyle = "#f5ead9";
      ctx.beginPath();
      ctx.moveTo(28, 52);
      ctx.lineTo(28, 24);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(28, 18);
      ctx.lineTo(23, 30);
      ctx.lineTo(33, 30);
      ctx.closePath();
      ctx.fillStyle = "#f5ead9";
      ctx.fill();
      ctx.fillText("N", 24, 66);
    };
    if (img.complete) draw();
    else img.onload = draw;
    // redraw when image cached
    const t = setTimeout(draw, 60);
    return () => clearTimeout(t);
  }, [pkg, result, strategy, selectedSiteId, redrawKey, runtimeRef, lang]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
      aria-label="2D plan view with routes, science sites and scale bar"
    />
  );
}
