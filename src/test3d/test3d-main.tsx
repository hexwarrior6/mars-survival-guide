import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function Box() {
  const ref = useRef<THREE.Mesh | null>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta;
  });
  return (
    <mesh ref={ref} position={[0, 0.5, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#d9915b" />
    </mesh>
  );
}

function App() {
  return (
    <Canvas
      camera={{ position: [3, 2, 4], fov: 50 }}
      onCreated={(s) => {
        const el = document.getElementById("s");
        if (el) el.textContent = "created ok, calls: " + s.gl.info.render.calls;
        (window as unknown as Record<string, unknown>).__created = true;
      }}
    >
      <color attach="background" args={["#111827"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 2]} intensity={2} />
      <Box />
    </Canvas>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
