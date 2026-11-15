/** Scene dressing for the sandbox: sky, drifting dust, and the post chain.
 *
 * All three are display-only. The sky is a gradient + sun glow (not measured
 * sky radiance), the dust is atmosphere, and the bloom only amplifies what is
 * already bright (route, beacons, the sun). None of it touches the data layer.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** sun direction used by the key light and the baked shadows: NW, low */
export const SUN_DIR = new THREE.Vector3(-0.707, 0.259, -0.658).normalize();

const SKY_RADIUS = 16000;

function softDot(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,246,232,1)");
    grad.addColorStop(0.3, "rgba(255,214,170,0.5)");
    grad.addColorStop(1, "rgba(255,180,110,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Sky(): JSX.Element {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: { uSun: { value: SUN_DIR.clone() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          uniform vec3 uSun;
          void main() {
            float h = clamp(vDir.y, -1.0, 1.0);
            vec3 zenith = vec3(0.007, 0.005, 0.004);
            vec3 horizon = vec3(0.085, 0.033, 0.016);
            vec3 col = mix(horizon, zenith, smoothstep(-0.01, 0.16, h));
            float sun = pow(max(dot(vDir, normalize(uSun)), 0.0), 90.0);
            col += vec3(1.0, 0.52, 0.22) * sun * 0.16;
            col = mix(col * 0.10, col, smoothstep(-0.30, 0.0, h));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );
  return (
    <mesh
      name="sky"
      material={material}
      frustumCulled={false}
      renderOrder={-1000}
      raycast={() => null}
    >
      <sphereGeometry args={[SKY_RADIUS, 48, 32]} />
    </mesh>
  );
}

/** slow-drifting dust: cheap atmosphere, hidden under reduced-motion */
export function Dust(): JSX.Element {
  const texture = useMemo(() => softDot(), []);
  const geometry = useMemo(() => {
    const count = 900;
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 6200;
      positions[i * 3 + 1] = Math.random() * 380 - 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6200;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 26,
        map: texture,
        color: new THREE.Color("#ffc38f"),
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    [texture],
  );
  const ref = useRef<THREE.Points | null>(null);
  useFrame((_, delta) => {
    const p = ref.current;
    if (p === null) return;
    p.rotation.y += delta * 0.004;
    p.position.x = Math.sin(p.rotation.y * 12) * 90;
  });
  return <points ref={ref} name="dust" geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * Bloom + output pass. Registered with renderPriority 1, which makes R3F hand
 * the frame over to this pass chain instead of drawing the scene to screen.
 * Mounted only when the sandbox decides post is affordable (WebGL2, motion
 * allowed); otherwise R3F renders normally and nothing here runs.
 */
/** Manual overrides: ?post=force keeps the chain on, ?post=off skips it. */
const POST_MODE: "auto" | "force" | "off" = (() => {
  const v = new URLSearchParams(location.search).get("post");
  return v === "force" ? "force" : v === "off" ? "off" : "auto";
})();

export function PostFXGate({ reducedMotion }: { reducedMotion: boolean }): JSX.Element | null {
  const webgl2 = useThree((state) => state.gl.capabilities.isWebGL2);
  const [enabled, setEnabled] = useState(POST_MODE !== "off");
  const sample = useRef({ t: 0, n: 0, done: POST_MODE !== "auto" });

  // Adaptive quality: the bloom chain roughly doubles the GPU work. On a slow
  // machine (or a software renderer) that is the difference between 60 and 6
  // fps, so measure the first ~1.6 s of real frames and drop the chain if the
  // average frame is slower than 30 fps. The sandbox stays usable either way.
  useFrame((_, delta) => {
    const s = sample.current;
    if (s.done) return;
    s.t += delta;
    s.n += 1;
    if (s.t < 1.6) return;
    s.done = true;
    if (s.t / s.n > 1 / 30) setEnabled(false);
  });

  if (!webgl2 || reducedMotion || !enabled) return null;
  return <PostFX />;
}

export function PostFX(): JSX.Element | null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  const composer = useMemo(() => {
    try {
      const c = new EffectComposer(gl);
      c.addPass(new RenderPass(scene, camera));
      c.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(size.width, size.height),
          0.34, // strength
          0.6, // radius
          0.9, // threshold: only the route, beacons and the sun bloom
        ),
      );
      c.addPass(new OutputPass());
      return c;
    } catch {
      // a failed post chain must never take the sandbox down
      return null;
    }
    // size is applied through setSize below; rebuilding on every resize is waste
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  useEffect(() => {
    composer?.setSize(size.width, size.height);
  }, [composer, size]);

  // the composer renders several passes per frame; accumulate the stats across
  // them so the HUD keeps reporting the real per-frame draw-call count
  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  useEffect(() => {
    return () => {
      composer?.dispose();
    };
  }, [composer]);

  useFrame(() => {
    gl.info.reset();
    // a null composer means the chain failed to build: draw normally instead
    if (composer !== null) composer.render();
    else gl.render(scene, camera);
  }, 1);

  return null;
}
