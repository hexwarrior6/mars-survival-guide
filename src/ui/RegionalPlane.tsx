/** Fixed regional surround: resolves on approach, darkens near the task, then
 * retires during the boundary-lock effect. The camera and geometry never jump.
 */
import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedPackage } from "../domain/load.js";
import { regionalGeometry } from "./regionalGeometry.js";
import { contextPresentation } from "./marsApproach.js";
import type { MarsPhase } from "./MarsScene.js";

export function RegionalPlane({ pkg, phase, scanReveal }: { pkg: LoadedPackage; phase: MarsPhase; scanReveal: { value: number } }): JSX.Element {
  const texture = useTexture("/data/mars/jezero_region_60km.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const camera = useThree(s => s.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({
    uContextShade: { value: 1 },
    uContextBlur: { value: 5 },
  }), []);
  const geometry = useMemo(() => regionalGeometry(pkg.terrain), [pkg]);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, transparent: true, depthWrite: false });
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uContextShade;\nuniform float uContextBlur;")
        .replace("#include <map_fragment>", `
          vec2 texel = vec2(uContextBlur / 2048.0);
          vec4 image = texture2D(map, vMapUv) * 0.4;
          image += texture2D(map, vMapUv + vec2(texel.x, 0.0)) * 0.15;
          image += texture2D(map, vMapUv - vec2(texel.x, 0.0)) * 0.15;
          image += texture2D(map, vMapUv + vec2(0.0, texel.y)) * 0.15;
          image += texture2D(map, vMapUv - vec2(0.0, texel.y)) * 0.15;
          diffuseColor *= image;
        `)
        .replace("#include <alphamap_fragment>", `
          #include <alphamap_fragment>
          // Rounded rectangular footprint with a 4.5 km feather at the outer
          // crop edge. UVs cover the entire regional map, so the inner mission
          // opening and its measured DEM seam remain fully opaque.
          vec2 contextCorner = abs(vMapUv - 0.5) - vec2(0.38);
          float contextEdge = length(max(contextCorner, 0.0))
            + min(max(contextCorner.x, contextCorner.y), 0.0) - 0.12;
          diffuseColor.a *= 1.0 - smoothstep(-0.075, 0.0, contextEdge);
        `)
        // Shade after fog too, so the retiring surround fades to black.
        .replace("#include <fog_fragment>", "#include <fog_fragment>\ngl_FragColor.rgb *= uContextShade;");
    };
    return mat;
  }, [texture, uniforms]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => {
    const state = contextPresentation(camera.position.length(), phase, scanReveal.value);
    material.opacity = state.opacity;
    uniforms.uContextShade.value = state.shade;
    uniforms.uContextBlur.value = state.blur;
    if (mesh.current) mesh.current.visible = state.opacity > 0;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} name="regional-surround" renderOrder={10} />;
}
