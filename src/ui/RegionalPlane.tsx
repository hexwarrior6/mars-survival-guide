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
import { contextPresentation, globeOrientation, globeSurfaceGrade } from "./marsApproach.js";
import type { MarsPhase } from "./MarsScene.js";

export function RegionalPlane({ pkg, phase, scanReveal }: { pkg: LoadedPackage; phase: MarsPhase; scanReveal: { value: number } }): JSX.Element {
  const [texture, globeTexture] = useTexture(["/data/mars/jezero_region_60km.jpg", "/data/mars/viking_mdim21_color_3840.jpg"]) as [THREE.Texture, THREE.Texture];
  globeTexture.colorSpace = THREE.SRGBColorSpace;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const camera = useThree(s => s.camera);
  const mesh = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => {
    const bounds = pkg.region.boundsLatLon;
    const inverseFrame = globeOrientation((bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2).invert();
    return {
      uContextShade: { value: 1 },
      uContextBlur: { value: 5 },
      uContextGlobe: { value: globeTexture },
      uContextGrade: { value: 0 },
      uContextToGlobe: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(inverseFrame)) },
    };
  }, [pkg, globeTexture]);
  const geometry = useMemo(() => regionalGeometry(pkg.terrain), [pkg]);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, transparent: true, depthWrite: false, fog: false });
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
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
        `)
        .replace("#include <map_fragment>", `
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
        `)
        .replace("#include <alphamap_fragment>", `
          #include <alphamap_fragment>
          // Fade only the outer crop; the measured mission seam stays intact.
          diffuseColor.a *= contextFeather(vMapUv);
        `)
        // Orbital context deliberately bypasses the close-range sandbox fog.
        // Only the final approach/lock dims this surface, toward neutral black.
        .replace("#include <fog_fragment>", `
          #include <fog_fragment>
          // Regional context is monochrome throughout the descent, including
          // its lighting and the sampled globe colour at the feathered edge.
          float contextGrey = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor.rgb = vec3(contextGrey) * uContextShade;
        `);
    };
    return mat;
  }, [texture, uniforms]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(() => {
    const state = contextPresentation(camera.position.length(), phase, scanReveal.value);
    material.opacity = state.opacity;
    uniforms.uContextShade.value = state.shade;
    uniforms.uContextBlur.value = state.blur;
    uniforms.uContextGrade.value = globeSurfaceGrade(camera.position.length());
    if (mesh.current) mesh.current.visible = state.opacity > 0;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} name="regional-surround" renderOrder={10} />;
}
