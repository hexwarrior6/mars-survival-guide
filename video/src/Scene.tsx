import React, { useLayoutEffect, useMemo } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import {
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import * as T from "three";
export type Point = [number, number, number];
export type Mission = {
  width: number;
  heights: number[];
  base: Point;
  site: { name: string; position: Point };
  sites: { name: string; position: Point }[];
  outbound: Point[];
  returnRoute: Point[];
  emergency: Point[];
  closure: Point[];
  totals: {
    distanceM: number;
    minutes: number;
    oxygen: number;
    battery: number;
  };
  states: {
    T: number;
    position: Point;
    oxygen: number;
    battery: number;
    phase: string;
    leg: string;
  }[];
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};
function Camera({ data, mode }: { data: Mission; mode: string }) {
  const frame = useCurrentFrame();
  const { camera } = useThree();
  const s = frame / 30;
  const p = data.states[Math.min(frame, 900)].position;
  let pos: Point = [5, 5, 6],
    target: Point = [0, 0.25, 0];
  if (mode === "globe") {
    pos = [
      0,
      0,
      interpolate(frame, [0, 105], [7.5, 4.6], { extrapolateRight: "clamp" }),
    ];
    target = [0, 0, 0];
  } else if (mode === "helmet") {
    const ahead = data.states[Math.min(frame + 9, 599)].position;
    pos = [p[0] + 0.6, p[1] + 0.9, p[2] + 0.8];
    let dx = ahead[0] - p[0],
      dz = ahead[2] - p[2];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    target = [p[0] + dx * 0.3, p[1] + 0.03, p[2] + dz * 0.3];
  } else if (s < 7.5) {
    const q = ease((s - 3.75) / 3.75);
    pos = [6.8 - q * 1.6, 5.6 - q * 1.4, 6.2 - q * 1.3];
  } else if (s < 11.25) {
    const q = (s - 7.5) / 3.75;
    pos = [3.5 - q * 1.3, 3.8, 4.9];
    target = [0.2, 0.3, -0.15];
  } else if (s < 14.0625) {
    pos = [-4.3, 4.3, 5.6];
    target = [0, 0.2, 0];
  } else if (s < 19.6875) {
    const q = (s - 17.8125) / 1.875;
    pos = [p[0] + 1.9, 2.8, p[2] + 1.7 + q * 0.4];
    target = [p[0], p[1], p[2]];
  } else if (s < 24.375) {
    const q = clamp((s - 20.625) / 3.75);
    pos = [-3.9 + q * 2.2, 4.8, 4.4];
    target = [0.25, 0.25, -0.15];
  } else {
    const q = clamp((s - 24.375) / 5.625);
    pos = [3.8 + q * 2.2, 4.5 + q, 5.2 + q];
    target = [0, 0.2, 0];
  }
  useLayoutEffect(() => {
    camera.position.set(...pos);
    camera.lookAt(...target);
    camera.updateProjectionMatrix();
  }, [frame, mode]);
  return null;
}
function Stars() {
  const geo = useMemo(() => {
    const g = new T.BufferGeometry();
    let seed = 73;
    const r = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const a = new Float32Array(1300 * 3);
    for (let i = 0; i < 1300; i++) {
      const az = r() * Math.PI * 2,
        z = r() * 2 - 1,
        rr = Math.sqrt(1 - z * z);
      a.set([Math.cos(az) * rr * 65, z * 65, Math.sin(az) * rr * 65], i * 3);
    }
    g.setAttribute("position", new T.BufferAttribute(a, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial
        color="#d9c9b5"
        size={0.055}
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}
function Globe() {
  const f = useCurrentFrame();
  const tex = useTexture(staticFile("mars.jpg"));
  tex.colorSpace = T.SRGBColorSpace;
  return (
    <group position={[0.7, 0, 0]} rotation={[0.12, -1.45 + f * 0.0018, -0.12]}>
      <mesh>
        <sphereGeometry args={[2.05, 96, 64]} />
        <meshStandardMaterial map={tex} roughness={0.94} />
      </mesh>
      <mesh scale={1.025}>
        <sphereGeometry args={[2.05, 64, 48]} />
        <shaderMaterial
          transparent
          side={T.BackSide}
          blending={T.AdditiveBlending}
          depthWrite={false}
          vertexShader={
            "varying vec3 vN; varying vec3 vP; void main(){vN=normalize(normalMatrix*normal);vec4 p=modelViewMatrix*vec4(position,1.);vP=p.xyz;gl_Position=projectionMatrix*p;}"
          }
          fragmentShader={
            "varying vec3 vN; varying vec3 vP;void main(){float a=pow(1.-abs(dot(normalize(vN),normalize(-vP))),3.);gl_FragColor=vec4(.72,.24,.075,a*.62);}"
          }
        />
      </mesh>
    </group>
  );
}
function terrainGeometry(data: Mission) {
  const g = new T.BufferGeometry(),
    a = new Float32Array(256 * 256 * 3),
    uv = new Float32Array(256 * 256 * 2),
    idx = [];
  for (let r = 0; r < 256; r++)
    for (let c = 0; c < 256; c++) {
      const i = r * 256 + c;
      a.set(
        [(c + 0.5) * 0.02 - 2.56, data.heights[i], (r + 0.5) * 0.02 - 2.56],
        i * 3,
      );
      uv.set([(c + 0.5) / 256, 1 - (r + 0.5) / 256], i * 2);
      if (c < 255 && r < 255) {
        const d = i + 256;
        idx.push(i, d, i + 1, i + 1, d, d + 1);
      }
    }
  g.setAttribute("position", new T.BufferAttribute(a, 3));
  g.setAttribute("uv", new T.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function sidesGeometry(data: Mission) {
  const ring: number[] = [];
  for (let c = 0; c < 256; c++) ring.push(c);
  for (let r = 1; r < 256; r++) ring.push(r * 256 + 255);
  for (let c = 254; c >= 0; c--) ring.push(255 * 256 + c);
  for (let r = 254; r > 0; r--) ring.push(r * 256);
  const a: number[] = [],
    idx: number[] = [];
  ring.forEach((v, i) => {
    const x = ((v % 256) + 0.5) * 0.02 - 2.56,
      z = (Math.floor(v / 256) + 0.5) * 0.02 - 2.56;
    a.push(x, data.heights[v], z, x, -0.3, z);
    const n = (i + 1) % ring.length;
    idx.push(i * 2, i * 2 + 1, n * 2, i * 2 + 1, n * 2 + 1, n * 2);
  });
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(a, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function Path({
  points,
  color,
  progress = 1,
  width = 0.009,
  opacity = 1,
}: {
  points: Point[];
  color: string;
  progress?: number;
  width?: number;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const curve = new T.CurvePath<T.Vector3>();
    for (let i = 1; i < points.length; i++)
      curve.add(
        new T.LineCurve3(
          new T.Vector3(
            points[i - 1][0],
            points[i - 1][1] + 0.012,
            points[i - 1][2],
          ),
          new T.Vector3(points[i][0], points[i][1] + 0.012, points[i][2]),
        ),
      );
    return new T.TubeGeometry(
      curve,
      Math.max(50, points.length * 3),
      width,
      5,
      false,
    );
  }, [points, width]);
  geometry.setDrawRange(
    0,
    Math.floor(((geometry.index?.count || 0) * clamp(progress)) / 30) * 30,
  );
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}
function Marker({
  position,
  selected = false,
}: {
  position: Point;
  selected?: boolean;
}) {
  const f = useCurrentFrame();
  return (
    <group position={position}>
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.005, 0.005, 0.14, 8]} />
        <meshBasicMaterial color={selected ? "#ffb45e" : "#fff3dd"} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry
          args={[selected ? 0.07 : 0.035, selected ? 0.08 : 0.045, 64]}
        />
        <meshBasicMaterial
          color={selected ? "#ffb45e" : "#fff3dd"}
          side={T.DoubleSide}
        />
      </mesh>
      {selected && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.016, 0]}
          scale={1 + ((f % 30) / 30) * 0.5}
        >
          <ringGeometry args={[0.085, 0.089, 64]} />
          <meshBasicMaterial
            color="#ffb45e"
            transparent
            opacity={1 - (f % 30) / 30}
            side={T.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
export function Terrain({
  data,
  mode,
  reveal = 1,
  scanDirection = [1, 0],
  approachShade = 1,
}: {
  data: Mission;
  mode: string;
  reveal?: number;
  scanDirection?: [number, number];
  approachShade?: number;
}) {
  const f = useCurrentFrame(),
    s = f / 30;
  const [tex, regionPhoto] = useTexture([
    staticFile("ortho.jpg"),
    staticFile("region.jpg"),
  ]);
  regionPhoto.colorSpace = T.SRGBColorSpace;
  const revealUniforms = useMemo(
    () => ({
      uReveal: { value: 1 },
      uScanDirection: { value: new T.Vector2(1, 0) },
      uApproachShade: { value: 1 },
      uApproachPhoto: { value: regionPhoto },
    }),
    [regionPhoto],
  );
  revealUniforms.uReveal.value = reveal;
  revealUniforms.uScanDirection.value.set(...scanDirection);
  revealUniforms.uApproachShade.value = approachShade;
  const surfaceMaterial = useMemo(() => {
    const mat = new T.MeshStandardMaterial({
      map: tex,
      color: "#cfb9a3",
      roughness: 0.95,
      side: T.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, revealUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec2 vTaskXZ;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTaskXZ = position.xz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
        varying vec2 vTaskXZ;
        uniform float uReveal;
        uniform vec2 uScanDirection;
        uniform float uApproachShade;
        uniform sampler2D uApproachPhoto;
        float revealExtent() { return dot(abs(uScanDirection), vec2(2.55)); }
        float revealFront() { float e = revealExtent(); return mix(-e - .18, e + .18, uReveal); }
        float taskMask() { return uReveal >= .999 ? 1. : (uReveal <= .001 ? 0. : 1. - smoothstep(revealFront() - .065, revealFront() + .065, dot(vTaskXZ, uScanDirection))); }
      `,
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
        // Same regional image and projected UVs as the surround: no warm tile
        // or separate local-photo rectangle appears during the grey descent.
        vec2 approachUv = vec2(.5 + (vTaskXZ.x - 6.1) / 60., .5 - vTaskXZ.y / 60.);
        vec3 approachPhoto = texture2D(uApproachPhoto, approachUv).rgb;
        float approachLuma = dot(approachPhoto, vec3(.2126,.7152,.0722));
        approachPhoto = mix(approachPhoto, approachLuma * vec3(1.035,1.,.98), .6);
        diffuseColor.rgb = mix(approachPhoto, diffuseColor.rgb, taskMask());
      `,
        )
        .replace(
          "#include <dithering_fragment>",
          `
        float mask = taskMask();
        float grey = dot(gl_FragColor.rgb, vec3(.2126,.7152,.0722));
        gl_FragColor.rgb = mix(vec3(grey) * uApproachShade, gl_FragColor.rgb, mask);
        if (uReveal > .001 && uReveal < .999) {
          float d = abs(dot(vTaskXZ, uScanDirection) - revealFront());
          float core = 1. - smoothstep(.006, .045, d);
          float beam = 1. - smoothstep(.025, .12, d);
          float halo = 1. - smoothstep(.04, .25, d);
          gl_FragColor.rgb += vec3(1.,.91,.75) * core * 1.5 + vec3(1.,.62,.26) * (beam*.55 + halo*.15);
        }
        #include <dithering_fragment>
      `,
        );
    };
    mat.customProgramCacheKey = () => "film-regional-to-clay-scan-v1";
    return mat;
  }, [tex, revealUniforms]);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 8;
  const geo = useMemo(() => terrainGeometry(data), [data]),
    sides = useMemo(() => sidesGeometry(data), [data]);
  const progress = clamp((s - 7.5) / 1.7),
    emergency = s >= 20.625;
  const pos = data.states[Math.min(f, 900)].position;
  const boxPts = useMemo(
    () =>
      [...data.closure, data.closure[0]].map(
        (p) => [p[0], p[1] + 0.025, p[2]] as Point,
      ),
    [data],
  );
  return (
    <group>
      <mesh geometry={geo} material={surfaceMaterial} />
      <mesh geometry={sides} visible={mode !== "opening" || reveal > 0.97}>
        <meshStandardMaterial
          color="#473428"
          roughness={0.85}
          side={T.DoubleSide}
        />
      </mesh>
      <mesh
        position={[0, -0.34, 0]}
        visible={mode !== "opening" || reveal > 0.97}
      >
        <boxGeometry args={[5.16, 0.08, 5.16]} />
        <meshStandardMaterial
          color="#171513"
          metalness={0.6}
          roughness={0.35}
        />
      </mesh>
      <gridHelper
        visible={mode !== "opening" || reveal > 0.999}
        args={[12, 24, "#342921", "#201b17"]}
        position={[0, -0.4, 0]}
      />
      {s >= 7.5 && (
        <>
          <Path
            points={data.outbound}
            color={emergency ? "#81756a" : "#fff3dd"}
            progress={progress}
            opacity={emergency ? 0.35 : 1}
          />
          <Path
            points={data.returnRoute}
            color={emergency ? "#81756a" : "#ffb45e"}
            progress={clamp((s - 8.4) / 1.7)}
            opacity={emergency ? 0.3 : 0.8}
          />
        </>
      )}
      {emergency && (
        <>
          <Path
            points={data.emergency}
            color="#ffb45e"
            width={0.015}
            progress={clamp((s - 20.625) / 1.2)}
          />
          <Path points={boxPts} color="#ff6252" width={0.014} />
        </>
      )}
      {mode !== "helmet" && mode !== "opening" && (
        <>
          <Marker position={data.base} />
          {data.sites.map((site, i) => (
            <Marker key={i} position={site.position} selected={i === 1} />
          ))}
          {s >= 14 && (
            <group position={[pos[0], pos[1] + 0.025, pos[2]]}>
              <mesh>
                <sphereGeometry args={[0.025, 16, 12]} />
                <meshBasicMaterial color="#fff3dd" />
              </mesh>
              <mesh position={[0, 0.15, 0]}>
                <cylinderGeometry args={[0.003, 0.016, 0.3, 12]} />
                <meshBasicMaterial color="#ffb45e" transparent opacity={0.75} />
              </mesh>
            </group>
          )}
        </>
      )}
    </group>
  );
}
// Tone mapping exposure must follow the scene mode on every rendered frame:
// one Canvas is mounted for the whole film (initially in globe mode), so the
// value cannot be set once in onCreated. Setting it inside useFrame runs in
// the render loop right before each capture. Must live inside <ThreeCanvas>.
function ExposureRig({ mode }: { mode: string }) {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (gl) gl.toneMappingExposure = mode === "globe" ? 1.35 : 2.0;
  });
  return null;
}
export function Scene({ data, mode }: { data: Mission; mode: string }) {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas
      width={width}
      height={height}
      dpr={1}
      camera={{ fov: mode === "helmet" ? 70 : 40, near: 0.001, far: 150 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = T.ACESFilmicToneMapping;
      }}
      >
      <ExposureRig mode={mode} />
      <Camera data={data} mode={mode} />
      {mode === "helmet" && (
        <>
          <color attach="background" args={["#241b16"]} />
          <fog attach="fog" args={["#241b16", 1, 5]} />
        </>
      )}
      <ambientLight intensity={mode === "globe" ? 0.18 : 0.85} />
      <directionalLight
        position={mode === "globe" ? [5, 2, 4] : [7, 5, -5]}
        intensity={mode === "globe" ? 3.1 : 2.5}
      />
      <directionalLight
        position={[-5, 3, 6]}
        intensity={0.45}
        color="#e0c6b2"
      />
      {mode === "globe" ? (
        <>
          <Stars />
          <Globe />
        </>
      ) : (
        <Terrain data={data} mode={mode} />
      )}
    </ThreeCanvas>
  );
}
