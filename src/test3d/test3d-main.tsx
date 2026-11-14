import { StrictMode, useEffect, useRef, useState } from "react";
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
    const [frameloop, setFrameloop] = useState<"always" | "never">("always");
    const handleStall = () => setFrameloop("never");
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

function StallGuard({ onStall }: { onStall: () => void }) {
  const last = useRef(performance.now());
  useFrame(() => {
    last.current = performance.now();
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      if (performance.now() - last.current > 1500) onStall();
    }, 400);
    return () => window.clearInterval(id);
  }, [onStall]);
  return null;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
