import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DIVE_SECONDS, approachPlaybackRate, globeSurfaceGrade, contextPresentation, approachPose, approachStage, globeOrientation, latLonToPoint, MARS_CENTRE, MARS_RADIUS } from "../src/ui/marsApproach.js";

const from = new THREE.Vector3(0.27, 0.878, 0.396).normalize().multiplyScalar(MARS_RADIUS * 3).add(MARS_CENTRE);
const to = new THREE.Vector3(-1152, 4464, 6336);
const target = new THREE.Vector3(0, 72, 0);

describe("Mars geographical zoom continuity", () => {
  it("aligns the mission point and geographic east/north with the local DEM", () => {
    for (const [lat, lon] of [[18.47, 77.43], [-4.5, 137.4], [70, -175]]) {
      const q = globeOrientation(lat!, lon!);
      expect(latLonToPoint(lat!, lon!, MARS_RADIUS).applyQuaternion(q).add(MARS_CENTRE).length()).toBeLessThan(1e-8);
      const east = latLonToPoint(lat!, lon! + 0.001, MARS_RADIUS).applyQuaternion(q);
      const north = latLonToPoint(lat! + 0.001, lon!, MARS_RADIUS).applyQuaternion(q);
      expect(east.x).toBeGreaterThan(0);
      expect(Math.abs(east.z)).toBeLessThan(0.001);
      expect(north.z).toBeLessThan(0);
      expect(Math.abs(north.x)).toBeLessThan(0.001);
    }
  });

  it("preserves the actual orbit gaze and ends exactly at the controls handoff", () => {
    const start = approachPose(from, to, target, 0);
    expect(start.position.distanceTo(from)).toBeLessThan(1e-7);
    expect(start.target.distanceTo(MARS_CENTRE)).toBe(0);
    const end = approachPose(from, to, target, 1);
    expect(end.position.distanceTo(to)).toBeLessThan(1e-7);
    expect(end.target.distanceTo(target)).toBe(0);
  });

  it("descends continuously through all three scales at 60 fps", () => {
    let previous = approachPose(from, to, target, 0);
    const stages = new Set<number>();
    for (let frame = 1; frame <= 600; frame++) {
      const pose = approachPose(from, to, target, frame / 600);
      expect(pose.distance).toBeLessThanOrEqual(previous.distance);
      // Relative apparent-scale change stays below 3% per rendered frame.
      expect(previous.distance / pose.distance).toBeLessThan(1.03);
      const view = pose.target.clone().sub(pose.position).normalize();
      const previousView = previous.target.clone().sub(previous.position).normalize();
      expect(view.angleTo(previousView)).toBeLessThan(0.02);
      expect(pose.position.y).toBeGreaterThan(0);
      stages.add(approachStage(pose.position.length()));
      previous = pose;
    }
    expect([...stages]).toEqual([1, 2, 3]);
  });

  it("reports map scale independently of surface visibility", () => {
    expect(approachStage(1000000)).toBe(1);
    expect(approachStage(60000)).toBe(2);
    expect(approachStage(to.length())).toBe(3);
  });
});

describe("approach context presentation", () => {
  it("keeps the regional overview bright and delays isolation until the last approach", () => {
    for (const distance of [77700, 60000, 28000, 20000]) {
      expect(contextPresentation(distance, "dive", 1).shade).toBe(1);
    }
    const nearTask = contextPresentation(16000, "dive", 1);
    expect(nearTask.shade).toBeLessThan(1);
    expect(nearTask.shade).toBeGreaterThan(0.16);
    expect(contextPresentation(12000, "dive", 1).shade).toBeCloseTo(0.16);
  });

  it("resolves detail gradually without hiding the region during the descent", () => {
    let previousBlur = Infinity;
    let previousOpacity = 0;
    for (const distance of [1000000, 320000, 200000, 140000, 90000, 45000, 20000, 8000]) {
      const state = contextPresentation(distance, "dive", 1);
      expect(state.blur).toBeLessThanOrEqual(previousBlur);
      expect(state.opacity).toBeGreaterThanOrEqual(previousOpacity);
      expect(state.opacity).toBeGreaterThan(0);
      previousBlur = state.blur;
      previousOpacity = state.opacity;
    }
    expect(contextPresentation(8000, "dive", 1)).toEqual({ opacity: 1, shade: expect.closeTo(0.16), blur: 0 });
  });

  it("keeps context continuous at arrival then removes it for the stable view", () => {
    const arriving = contextPresentation(8000, "dive", 1);
    const lockStart = contextPresentation(8000, "off", 0);
    expect(lockStart.opacity).toBe(arriving.opacity);
    expect(lockStart.shade).toBeCloseTo(arriving.shade);
    let previous = 1;
    for (let i = 0; i <= 100; i++) {
      const state = contextPresentation(8000, "off", i / 100);
      expect(state.opacity).toBeLessThanOrEqual(previous);
      previous = state.opacity;
    }
    // Initial intro=off, Skip, and reduced motion all use the stable endpoint.
    expect(contextPresentation(8000, "off", 1)).toEqual({ opacity: 0, shade: 0, blur: 0 });
    expect(contextPresentation(8000, "off", 0.999).opacity).toBe(0);
    expect(contextPresentation(1000000, "orbit", 1).opacity).toBeGreaterThan(0);
  });
});

describe("orbital pacing and colour handoff", () => {
  it("plays the opening at 2x and preserves the final approach timing", () => {
    expect(approachPlaybackRate(0)).toBe(2);
    expect(approachPlaybackRate(0.4)).toBe(2);
    expect(approachPlaybackRate(0.55)).toBeCloseTo(1.5);
    expect(approachPlaybackRate(0.65)).toBe(1);
    expect(approachPlaybackRate(1)).toBe(1);
    let virtualTime = 0, realTime = 0, finalLegStart = 0;
    const step = 1 / 240;
    while (virtualTime < DIVE_SECONDS) {
      if (virtualTime < DIVE_SECONDS * 0.65) finalLegStart = realTime;
      virtualTime += step * approachPlaybackRate(virtualTime / DIVE_SECONDS);
      realTime += step;
    }
    expect(realTime).toBeGreaterThan(7);
    expect(realTime).toBeLessThan(8);
    expect(realTime - finalLegStart).toBeCloseTo(3.5, 1);
  });

  it("gradually aligns the globe palette before the regional view takes over", () => {
    expect(globeSurfaceGrade(2000000)).toBe(0);
    let previous = 0;
    for (const distance of [1500000, 1000000, 500000, 200000, 140000, 100000, 60000]) {
      const grade = globeSurfaceGrade(distance);
      expect(grade).toBeGreaterThanOrEqual(previous);
      expect(grade).toBeGreaterThanOrEqual(0);
      expect(grade).toBeLessThanOrEqual(1);
      previous = grade;
    }
    expect(globeSurfaceGrade(100000)).toBe(1);
    expect(globeSurfaceGrade(140000)).toBeGreaterThan(0.95);
  });
});
