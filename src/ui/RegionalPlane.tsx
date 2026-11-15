/** Regional LOD between the Mars globe and the 5 km sandbox.
 *
 * The middle image is a 60 × 60 km crop of the same CTX ortho mosaic the package
 * was cut from (see public/data/mars/README.md), colourised with the sandbox's
 * own ramp so the hand-off to the terrain texture is seamless. It is a flat
 * decal just under the terrain plate, fading in as the globe fades out and out
 * again as the sandbox fills the frame.
 *
 * A plain MeshBasicMaterial plus a feathered alpha map: an unlit regional photo
 * is exactly the "map tile" this stage should read as, and it avoids the
 * shader/colour-space pitfalls of a custom pass.
 *
 * Display only: it never feeds routing, timing or resources.
 */

import { useMemo, useRef } from "react";
import type { JSX } from "react";
import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const SIZE_M = 60000;
/** the crop centre is 6.1 km east of the region centre (see the crop script) */
const CENTRE_X = 6100;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** white square with a soft border, used as the alpha map of the decal */
function featherAlpha(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const f = 22;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 256, 256);
    const edge = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      x: number,
      y: number,
      w: number,
      h: number,
    ): void => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    };
    edge(0, 0, f, 0, 0, 0, f, 256);
    edge(256, 0, 256 - f, 0, 256 - f, 0, f, 256);
    edge(0, 0, 0, f, 0, 0, 256, f);
    edge(0, 256, 0, 256 - f, 0, 256 - f, 256, f);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function RegionalPlane(): JSX.Element {
  const texture = useTexture("/data/mars/jezero_region_60km.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const alphaMap = useMemo(featherAlpha, []);
  const camera = useThree((state) => state.camera);
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const dist = camera.position.length();
    // visible between the globe and the sandbox; feathered at both ends
    const fadeIn = 1 - smoothstep(Math.log(60000), Math.log(140000), Math.log(dist));
    const fadeOut = smoothstep(Math.log(8000), Math.log(14000), Math.log(dist));
    const o = Math.min(fadeIn, fadeOut);
    const m = mesh.current;
    if (m === null) return;
    m.visible = o > 0.01;
    (m.material as THREE.MeshBasicMaterial).opacity = o;
  });

  return (
    <mesh
      ref={mesh}
      position={[CENTRE_X, -2, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      name="regional-plane"
      renderOrder={1}
    >
      <planeGeometry args={[SIZE_M, SIZE_M, 1, 1]} />
      <meshBasicMaterial
        map={texture}
        alphaMap={alphaMap}
        transparent
        opacity={0}
        depthWrite={false}
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}
