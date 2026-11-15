/** Space backdrop for the Mars stage: stars, a faint galactic band and a sun
 * glow, drawn as a camera-following sky sphere. Display only — the star field
 * is procedural decoration, not a sky catalogue.
 *
 * The sphere is scaled from the camera's near plane so it stays in front of the
 * near plane while the dive changes it by four orders of magnitude.
 */

import { useMemo, useRef } from "react";
import type { JSX } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SUN_DIR } from "./SceneDressing.js";

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

export function SpaceBackdrop({
  meshRef,
}: {
  /** the Mars scene owns the transform so the sky never lags the camera */
  meshRef: React.RefObject<THREE.Mesh | null>;
}): JSX.Element {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSun: { value: SUN_DIR.clone() },
      uFade: { value: 1 },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    // hand the background back to the console sky before the landing: otherwise
    // the star shell pops when the Mars scene unmounts
    const dist = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
    uniforms.uFade.value = smoothstep(Math.log(20000), Math.log(60000), Math.log(dist));
  });

  return (
    <mesh ref={meshRef} name="space-backdrop" frustumCulled={false} renderOrder={-900}>
      <sphereGeometry args={[1, 32, 24]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
        fog={false}
        toneMapped={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          varying vec3 vDir;
          uniform float uTime;
          uniform vec3 uSun;
          uniform float uFade;

          float h13(vec3 p) {
            p = fract(p * 0.1031);
            p += dot(p, p.yzx + 33.33);
            return fract((p.x + p.y) * p.z);
          }
          float vnoise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float n000 = h13(i);
            float n100 = h13(i + vec3(1.0, 0.0, 0.0));
            float n010 = h13(i + vec3(0.0, 1.0, 0.0));
            float n110 = h13(i + vec3(1.0, 1.0, 0.0));
            float n001 = h13(i + vec3(0.0, 0.0, 1.0));
            float n101 = h13(i + vec3(1.0, 0.0, 1.0));
            float n011 = h13(i + vec3(0.0, 1.0, 1.0));
            float n111 = h13(i + vec3(1.0, 1.0, 1.0));
            return mix(
              mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
              mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
              f.z
            );
          }

          void main() {
            vec3 d = normalize(vDir);

            // --- stars: one jittered point per grid cell ---------------------
            vec3 col = vec3(0.0);
            for (int layer = 0; layer < 2; layer++) {
              float density = layer == 0 ? 240.0 : 480.0;
              float threshold = layer == 0 ? 0.955 : 0.986;
              vec3 g = d * density;
              vec3 cell = floor(g);
              vec3 f = fract(g);
              float h = h13(cell + float(layer) * 17.0);
              if (h > threshold) {
                vec3 off = vec3(
                  h13(cell + 3.1),
                  h13(cell + 7.7),
                  h13(cell + 13.3)
                );
                float dist = length(f - off);
                float core = smoothstep(0.18, 0.0, dist);
                float halo = smoothstep(0.42, 0.0, dist) * 0.12;
                float twinkle = 0.55 + 0.45 * sin(uTime * 1.7 + h * 61.0);
                vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), h13(cell + 31.0));
                float mag = layer == 0 ? 2.0 : 0.85;
                col += tint * (core + halo) * twinkle * mag;
                // the rare bright star gets a soft flare
                if (h > 0.998) {
                  col += tint * smoothstep(0.85, 0.0, dist) * 0.35;
                }
              }
            }

            // --- faint galactic band: low, wide, slightly dusty ---------------
            vec3 axis = normalize(vec3(0.82, 0.34, 0.46));
            float band = exp(-pow(dot(d, axis) * 1.9, 2.0));
            float dust = vnoise(d * 3.4) * 0.6 + vnoise(d * 9.0) * 0.4;
            col += vec3(0.085, 0.10, 0.145) * band * (0.3 + 0.7 * dust);
            // a cool dust lobe on one side, so the field is not a flat black
            float lobe = pow(max(dot(d, normalize(vec3(-0.55, 0.35, -0.75))), 0.0), 2.6);
            float cloud = smoothstep(0.42, 0.9, vnoise(d * 2.1 + 7.0));
            col += vec3(0.022, 0.045, 0.085) * lobe * cloud;
            // very low-frequency haze so empty space is not pure black
            col += vec3(0.012, 0.016, 0.028) * vnoise(d * 1.6 + 9.0);

            // --- sun: tight core + restrained halo ---------------------------
            float sun = max(dot(d, normalize(uSun)), 0.0);
            col += vec3(1.0, 0.86, 0.66) * pow(sun, 1200.0) * 5.0;
            col += vec3(1.0, 0.55, 0.3) * pow(sun, 14.0) * 0.045;

            // fade the sky to black before the landing instead of fading alpha:
            // a transparent background would draw over the opaque terrain
            gl_FragColor = vec4(col * uFade, 1.0);
          }
        `}
      />
    </mesh>
  );
}
