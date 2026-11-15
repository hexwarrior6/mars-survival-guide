/** Opening "from Mars" stage.
 *
 * A real Viking MDIM 2.1 colour mosaic of the whole planet (NASA/JPL/USGS,
 * public domain — see public/data/mars/README.md), with the Jezero mission area
 * pinned from the package's own bounds. Clicking the marker dives the camera
 * onto that point; the overlay then dissolves to the Jezero terrain and the
 * normal console takes over.
 *
 * Display only: the globe is context, not part of the planning package, and it
 * never feeds a route, time or resource value. The marker is placed from the
 * real region bounds so it always sits at Jezero.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Stars, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Lang } from "./i18n.js";

const GLOBE_TEXTURE = "/data/mars/viking_mdim21_color_2048.jpg";
const RADIUS = 1;
const START_DIST = 4.0;
const END_DIST = 1.06;
/** MDIM 2.1 is a 0–360 east product displayed from 180°W, so u starts there */
const LON_ORIGIN_DEG = 180;
const EASE = (x: number): number => x * x * (3 - 2 * x);

/** lat/lon -> point on the sphere, matching Three's SphereGeometry UV layout */
function latLonToPoint(latDeg: number, lonDeg: number, r: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = ((lonDeg + LON_ORIGIN_DEG) * Math.PI) / 180;
  return new THREE.Vector3(
    -r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon),
  );
}

function GlobeSurface({
  lat,
  lon,
  reducedMotion,
  auto,
  onPrepare,
  onDiveStart,
  onArrive,
}: {
  lat: number;
  lon: number;
  reducedMotion: boolean;
  /** dev switch: ?intro=auto performs the dive without a click (demo capture) */
  auto: boolean;
  /** run before the fade: park the terrain camera under the opaque overlay */
  onPrepare: () => void;
  onDiveStart: () => void;
  onArrive: () => void;
}): JSX.Element {
  const texture = useTexture(GLOBE_TEXTURE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const camera = useThree((state) => state.camera);
  const spin = useRef<THREE.Group | null>(null);
  const marker = useRef<THREE.Group | null>(null);
  const [diving, setDiving] = useState(false);
  const t = useRef(0);
  const normal = useRef(new THREE.Vector3());
  const done = useRef(false);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );

  const markerPoint = useMemo(() => latLonToPoint(lat, lon, RADIUS * 1.004), [lat, lon]);
  const startPoint = useMemo(() => latLonToPoint(lat, lon, START_DIST), [lat, lon]);

  // face Jezero at mount; the camera is the same object the dive animates
  useEffect(() => {
    camera.position.copy(startPoint);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, startPoint]);

  useFrame((_, delta) => {
    // idle spin only until the user commits; the dive needs a fixed target
    if (spin.current !== null && !diving) spin.current.rotation.y += delta * 0.02;
    if (!diving || done.current) return;

    const step = reducedMotion ? 1 : delta / 2.3;
    t.current = Math.min(1, t.current + step);
    const k = EASE(t.current);
    camera.position.copy(normal.current).multiplyScalar(START_DIST + (END_DIST - START_DIST) * k);
    camera.lookAt(0, 0, 0);
    if (t.current > 0.7) onDiveStart();
    if (t.current >= 1) {
      done.current = true;
      onArrive();
    }
  });

  const pick = (): void => {
    if (diving) return;
    marker.current?.getWorldPosition(normal.current);
    normal.current.normalize();
    onPrepare();
    setDiving(true);
    if (reducedMotion) {
      done.current = true;
      onArrive();
    }
  };

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(pick, 2200);
    return () => window.clearTimeout(id);
    // pick only reads refs and local state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <>
      <ambientLight intensity={0.10} />
      <directionalLight position={[5.0, 2.2, -2.0]} intensity={2.5} color="#fff1df" />
      <Stars radius={45} depth={25} count={2200} factor={6} saturation={0} fade speed={0.3} />
      <group ref={spin}>
        <mesh>
          <sphereGeometry args={[RADIUS, 96, 64]} />
          <meshStandardMaterial map={texture} roughness={1} metalness={0} />
        </mesh>
        {/* thin atmospheric rim: the only invented part, and it is haze */}
        <mesh scale={1.012}>
          <sphereGeometry args={[RADIUS, 64, 48]} />
          <shaderMaterial
            side={THREE.BackSide}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            vertexShader={/* glsl */ `
              varying vec3 vN;
              varying vec3 vV;
              void main() {
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
              }
            `}
            fragmentShader={/* glsl */ `
              varying vec3 vN;
              varying vec3 vV;
              void main() {
                float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
                gl_FragColor = vec4(vec3(1.0, 0.5, 0.24) * rim * 0.55, rim * 0.55);
              }
            `}
          />
        </mesh>
        <group ref={marker} position={markerPoint}>
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              pick();
            }}
            onPointerOver={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry args={[0.016, 16, 16]} />
            <meshBasicMaterial color="#ffb45e" toneMapped={false} />
          </mesh>
          <Html center zIndexRange={[80, 80]} style={{ pointerEvents: "auto" }}>
            <button type="button" className={diving ? "mars-pin is-diving" : "mars-pin"} onClick={pick}>
              <b>JEZERO</b>
              <span>
                {lat.toFixed(2)}°N · {lon.toFixed(2)}°E
              </span>
            </button>
          </Html>
        </group>
      </group>
    </>
  );
}

export function MarsIntro({
  north,
  south,
  east,
  west,
  lang,
  reducedMotion,
  onPrepare,
  onEnter,
}: {
  north: number;
  south: number;
  east: number;
  west: number;
  lang: Lang;
  reducedMotion: boolean;
  onPrepare: () => void;
  onEnter: () => void;
}): JSX.Element {
  const [leaving, setLeaving] = useState(false);
  const arrived = useRef(false);
  const auto = new URLSearchParams(window.location.search).get("intro") === "auto";
  const lat = (north + south) / 2;
  const lon = (east + west) / 2;

  const enter = (): void => {
    if (arrived.current) return;
    arrived.current = true;
    onEnter();
  };
  const dive = (): void => setLeaving(true);
  const skip = (): void => {
    setLeaving(true);
    window.setTimeout(enter, 420);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") skip();
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        dive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`mars-stage${leaving ? " is-leaving" : ""}`} role="dialog" aria-label="Mars approach">
      <Canvas
        camera={{ fov: 30, near: 0.01, far: 120 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true }}
        onCreated={(state) => {
          state.gl.toneMapping = THREE.ACESFilmicToneMapping;
          state.gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#050403"]} />
        <Suspense fallback={null}>
          <GlobeSurface
            lat={lat}
            lon={lon}
            reducedMotion={reducedMotion}
            auto={auto}
            onPrepare={onPrepare}
            onDiveStart={dive}
            onArrive={enter}
          />
        </Suspense>
      </Canvas>

      <div className="mars-brand">
        <b>MARS SURVIVAL GUIDE</b>
        <span>{lang === "zh" ? "接近 · 耶泽罗任务区" : "APPROACH · JEZERO MISSION AREA"}</span>
      </div>

      <div className="mars-hint">
        <span>
          {lang === "zh"
            ? "点击标记进入耶泽罗，或按 Enter"
            : "Click the marker to enter Jezero, or press Enter"}
        </span>
        <button type="button" className="small" onClick={skip}>
          {lang === "zh" ? "跳过" : "Skip"}
        </button>
      </div>

      <div className="mars-credit">
        VIKING MDIM 2.1 COLOUR MOSAIC · NASA/JPL/USGS · PUBLIC DOMAIN
      </div>
    </div>
  );
}
