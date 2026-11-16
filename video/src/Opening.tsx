import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  Freeze,
  continueRender,
  delayRender,
  cancelRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useTexture, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as T from "three";
import { Terrain, type Mission, type Point } from "./Scene";
type Pose = {
  position: Point;
  target: Point;
  distance: number;
  range: number;
  progress: number;
  lock: number;
  globeOpacity: number;
  grade: number;
  context: { opacity: number; shade: number; blur: number };
};
type OpeningData = {
  frames: Pose[];
  spin: [number, number, number, number];
  regional: {
    positions: number[];
    uvs: number[];
    normals: number[];
    index: number[];
  };
  globeVertex: string;
  globeFragment: string;
  hazeVertex: string;
  hazeFragment: string;
};
const limit = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};
function Camera({ pose }: { pose: Pose }) {
  const camera = useThree((s) => s.camera) as T.PerspectiveCamera;
  useLayoutEffect(() => {
    camera.position.fromArray(pose.position);
    camera.lookAt(new T.Vector3().fromArray(pose.target));
    camera.near = Math.min(Math.max(pose.distance * 0.006, 50), 120000);
    camera.far = Math.max(pose.distance * 2.4, 45000);
    camera.updateProjectionMatrix();
  }, [pose, camera]);
  return null;
}
function Globe({ data, pose }: { data: OpeningData; pose: Pose }) {
  const [texture, normal] = useTexture([
    staticFile("mars-hires.jpg"),
    staticFile("mars-normal.png"),
  ]);
  texture.colorSpace = T.SRGBColorSpace;
  normal.colorSpace = T.NoColorSpace;
  const uniforms = useMemo(
    () => ({
      uMap: { value: texture },
      uNormal: { value: normal },
      uSun: { value: new T.Vector3(-0.707, 0.259, -0.658).normalize() },
      uOpacity: { value: 1 },
      uSurfaceGrade: { value: 0 },
    }),
    [texture, normal],
  );
  const haze = useMemo(() => ({ uOpacity: { value: 1 } }), []);
  uniforms.uOpacity.value = pose.globeOpacity;
  uniforms.uSurfaceGrade.value = pose.grade;
  haze.uOpacity.value = pose.globeOpacity;
  return (
    <group
      position={[0, -3396190, 0]}
      quaternion={new T.Quaternion().fromArray(data.spin)}
      visible={pose.globeOpacity > 0.005}
    >
      <mesh>
        <sphereGeometry args={[3396190, 192, 128]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={data.globeVertex}
          fragmentShader={data.globeFragment}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh scale={1.004}>
        <sphereGeometry args={[3396190, 64, 48]} />
        <shaderMaterial
          uniforms={haze}
          vertexShader={data.hazeVertex}
          fragmentShader={data.hazeFragment}
          side={T.BackSide}
          transparent
          depthWrite={false}
          blending={T.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
function Regional({ data, pose }: { data: OpeningData; pose: Pose }) {
  const [texture, globeTexture] = useTexture([
    staticFile("region.jpg"),
    staticFile("mars-hires.jpg"),
  ]);
  texture.colorSpace = T.SRGBColorSpace;
  globeTexture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  const geometry = useMemo(() => {
    const g = new T.BufferGeometry();
    g.setAttribute(
      "position",
      new T.Float32BufferAttribute(data.regional.positions, 3),
    );
    g.setAttribute("uv", new T.Float32BufferAttribute(data.regional.uvs, 2));
    g.setAttribute(
      "normal",
      new T.Float32BufferAttribute(data.regional.normals, 3),
    );
    g.setIndex(data.regional.index);
    return g;
  }, [data]);
  const uniforms = useMemo(
    () => ({
      uContextShade: { value: 1 },
      uContextBlur: { value: 5 },
      uContextGlobe: { value: globeTexture },
      uContextGrade: { value: 0 },
      uContextToGlobe: {
        value: new T.Matrix3().setFromMatrix4(
          new T.Matrix4().makeRotationFromQuaternion(
            new T.Quaternion().fromArray(data.spin).invert(),
          ),
        ),
      },
    }),
    [data, globeTexture],
  );
  const material = useMemo(() => {
    const mat = new T.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uContextShade;
          uniform float uContextBlur;
          uniform sampler2D uContextGlobe;
          uniform float uContextGrade;
          uniform mat3 uContextToGlobe;
          float contextFeather(vec2 uv) {
            // A broad 12 km transition with gently rounded corners.
            vec2 corner = abs(uv - 0.5) - vec2(0.28);
            float edge = length(max(corner, 0.0))
              + min(max(corner.x, corner.y), 0.0) - 0.22;
            return 1.0 - smoothstep(-0.20, 0.0, edge);
          }
        `,
        )
        .replace(
          "#include <map_fragment>",
          `
          vec2 texel = vec2(uContextBlur / 2048.0);
          vec4 image = texture2D(map, vMapUv) * 0.4;
          image += texture2D(map, vMapUv + vec2(texel.x, 0.0)) * 0.15;
          image += texture2D(map, vMapUv - vec2(texel.x, 0.0)) * 0.15;
          image += texture2D(map, vMapUv + vec2(0.0, texel.y)) * 0.15;
          image += texture2D(map, vMapUv - vec2(0.0, texel.y)) * 0.15;
          // Neutralize the baked warm tint before joining the globe palette.
          // Keep luminance/detail; the regional image must not become a brown
          // fog patch at orbital viewing distances.
          float regionalLuma = dot(image.rgb, vec3(0.2126, 0.7152, 0.0722));
          image.rgb = mix(image.rgb, regionalLuma * vec3(1.035, 1.0, 0.98), 0.6);
          // Match the actual globe imagery under this part of the map,
          // rather than fading a differently coloured rectangle into it.
          vec2 tangent = vec2((vMapUv.x - 0.5) * 60000.0 + 6100.0,
                              (0.5 - vMapUv.y) * 60000.0);
          float radius = 3396190.0;
          vec3 globeDirection = normalize(uContextToGlobe * vec3(tangent.x,
            sqrt(radius * radius - dot(tangent, tangent)), tangent.y));
          vec2 globeUv = vec2(fract(atan(globeDirection.z, -globeDirection.x) / 6.2831853 + 1.0),
                              0.5 + asin(clamp(globeDirection.y, -1.0, 1.0)) / 3.14159265);
          vec3 globeColour = texture2D(uContextGlobe, globeUv).rgb;
          float luma = dot(globeColour, vec3(0.2126, 0.7152, 0.0722));
          globeColour = mix(mix(vec3(luma), globeColour, 0.85),
                            vec3(luma) * vec3(1.08, 1.0, 0.94), uContextGrade * 0.88);
          image.rgb = mix(image.rgb, globeColour, (1.0 - contextFeather(vMapUv)) * 0.85);
          diffuseColor *= image;
        `,
        )
        .replace(
          "#include <alphamap_fragment>",
          `
          #include <alphamap_fragment>
          // Fade only the outer crop; the measured mission seam stays intact.
          diffuseColor.a *= contextFeather(vMapUv);
        `,
        )
        // Orbital context deliberately bypasses the close-range sandbox fog.
        // Only the final approach/lock dims this surface, toward neutral black.
        .replace(
          "#include <fog_fragment>",
          `
          #include <fog_fragment>
          // Regional context is monochrome throughout the descent, including
          // its lighting and the sampled globe colour at the feathered edge.
          float contextGrey = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor.rgb = vec3(contextGrey) * uContextShade;
        `,
        );
    };

    return mat;
  }, [texture, uniforms]);
  material.opacity = pose.context.opacity;
  uniforms.uContextShade.value = pose.context.shade;
  uniforms.uContextBlur.value = pose.context.blur;
  uniforms.uContextGrade.value = pose.grade;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={10}
      visible={pose.context.opacity > 0}
    />
  );
}
function Boundary({ data, lock }: { data: Mission; lock: number }) {
  const pts = useMemo(() => {
    const ids = [];
    for (let c = 0; c < 256; c++) ids.push(c);
    for (let r = 1; r < 256; r++) ids.push(r * 256 + 255);
    for (let c = 254; c >= 0; c--) ids.push(255 * 256 + c);
    for (let r = 254; r >= 0; r--) ids.push(r * 256);
    return ids.map(
      (i) =>
        [
          ((i % 256) + 0.5) * 20 - 2560,
          data.heights[i] * 1000 + 10,
          (Math.floor(i / 256) + 0.5) * 20 - 2560,
        ] as Point,
    );
  }, [data]);
  if (lock <= 0) return null;
  return (
    <Line
      points={pts.slice(
        0,
        Math.max(2, Math.floor(pts.length * Math.min(1, lock * 1.5))),
      )}
      color="#ffb45e"
      lineWidth={2}
      transparent
      opacity={Math.sin(Math.PI * Math.min(0.99, lock)) * 0.9}
    />
  );
}
export function Opening() {
  const f = useCurrentFrame(),
    { width, height } = useVideoConfig();
  const [assets, setAssets] = useState<{
    opening: OpeningData;
    mission: Mission;
  } | null>(null);
  const [hold] = useState(() =>
    delayRender("Loading continuous Mars approach"),
  );
  useEffect(() => {
    Promise.all([
      fetch(staticFile("opening.json")).then((r) => r.json()),
      fetch(staticFile("mission.json")).then((r) => r.json()),
    ])
      .then(([opening, mission]) => {
        setAssets({ opening, mission });
        continueRender(hold);
      })
      .catch(cancelRender);
  }, [hold]);
  if (!assets) return null;
  const pose = assets.opening.frames[Math.min(f, 263)];
  const camera = new T.PerspectiveCamera(40, width / height, 0.1, 1e9);
  camera.position.fromArray(pose.position);
  camera.lookAt(new T.Vector3().fromArray(pose.target));
  camera.updateMatrixWorld();
  const pin = new T.Vector3(0, 500, 0).project(camera);
  const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const scanDirection = new T.Vector2(right.x, right.z).normalize();
  const labelOpacity = interpolate(pose.range, [25000, 60000], [0, 1], limit);
  const stage =
    pose.range > 140000
      ? "01 / MARS"
      : pose.range > 28000
        ? "02 / JEZERO REGION"
        : "03 / MISSION AREA";
  return (
    <AbsoluteFill
      style={{
        background: "#0d0a08",
        fontFamily: '"Avenir Next","Helvetica Neue",Arial,sans-serif',
        color: "#f5ead9",
      }}
    >
      <ThreeCanvas
        width={width}
        height={height}
        dpr={1}
        camera={{ fov: 40, near: 50, far: 3e7 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = T.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.35;
        }}
      >
        <Camera pose={pose} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[7000, 5000, -5000]} intensity={2.5} />
        <directionalLight
          position={[-5000, 3000, 6000]}
          intensity={0.45}
          color="#e0c6b2"
        />
        <Globe data={assets.opening} pose={pose} />
        <Regional data={assets.opening} pose={pose} />
        <group scale={1000}>
          <Freeze frame={112}>
            <Terrain
              data={assets.mission}
              mode="opening"
              reveal={pose.lock}
              scanDirection={[scanDirection.x, scanDirection.y]}
              approachShade={pose.context.shade}
            />
          </Freeze>
        </group>
        <Boundary data={assets.mission} lock={pose.lock} />
      </ThreeCanvas>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(0deg,#0d0a08bc,transparent 30%,transparent 80%,#0d0a0860)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 65,
          fontFamily: "Menlo,monospace",
          fontSize: 17,
          letterSpacing: 4,
          color: "#ffb45e",
        }}
      >
        MARS SURVIVAL GUIDE
      </div>
      <div
        style={{
          position: "absolute",
          right: 100,
          top: 65,
          fontFamily: "Menlo,monospace",
          fontSize: 16,
          letterSpacing: 3,
          color: "#c9b8a4",
        }}
      >
        FROM ORBIT TO THE MISSION
      </div>
      <div
        style={{
          position: "absolute",
          left: 100,
          bottom: 165,
          opacity: interpolate(f, [0, 12, 68, 95], [0, 1, 1, 0], limit),
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 650,
            letterSpacing: -3,
            lineHeight: 1.05,
          }}
        >
          EVERY JOURNEY
          <br />
          STARTS <span style={{ color: "#ffb45e" }}>HERE.</span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: ((pin.x + 1) * width) / 2,
          top: ((1 - pin.y) * height) / 2,
          opacity: labelOpacity,
          translate: "-50% -50%",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            border: "2px solid #ffb45e",
            borderRadius: "50%",
            boxShadow: "0 0 25px #ffb45e",
          }}
        />
        <div
          style={{
            padding: "14px 20px",
            background: "#0d0a08b8",
            borderLeft: "2px solid #ffb45e",
            fontFamily: "Menlo,monospace",
            fontSize: 17,
            letterSpacing: 2,
          }}
        >
          JEZERO CRATER
          <br />
          <span style={{ fontSize: 13, color: "#ffb45e" }}>
            WESTERN DELTA / MISSION TARGET
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          bottom: 82,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "Menlo,monospace",
          fontSize: 18,
          letterSpacing: 3,
          color: "#ffb45e",
        }}
      >
        <span>{stage}</span>
        <span>
          CAMERA RANGE /{" "}
          {(pose.range / 1000).toLocaleString("en-US", {
            maximumFractionDigits: 1,
          }) + " KM"}
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          left: 100,
          bottom: 45,
          fontFamily: "Menlo,monospace",
          fontSize: 13,
          letterSpacing: 2,
          color: "#bcae9d",
        }}
      >
        REAL NASA IMAGERY · REGIONAL APRON / ARTISTIC DISPLAY
      </div>
      <AbsoluteFill
        style={{
          background: "#0d0a08",
          opacity: interpolate(f, [0, 10], [1, 0], limit),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}
