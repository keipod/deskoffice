import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Agent, AgentStatus } from "../shared/types";

function statusColor(status: AgentStatus) {
  if (status === "working") return 0x38bdf8;
  if (status === "meeting") return 0xa78bfa;
  if (status === "blocked") return 0xfb7185;
  if (status === "offline") return 0x64748b;
  return 0x34d399;
}

function labelSprite(agent: Agent) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(5,10,20,.88)";
  ctx.beginPath();
  ctx.roundRect(12, 12, 488, 104, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText(agent.name, 34, 58);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 24px system-ui, sans-serif";
  ctx.fillText(agent.currentTask ? agent.currentTask.slice(0, 26) : agent.title, 34, 94);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(4.2, 1.05, 1);
  sprite.position.set(0, 3.35, 0);
  return sprite;
}

function addDesk(scene: THREE.Scene, x: number, z: number) {
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 0.18, 1.55),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 })
  );
  desk.position.set(x, 0.92, z + 0.55);
  desk.castShadow = true;
  desk.receiveShadow = true;
  scene.add(desk);

  for (const dx of [-1.25, 1.25]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.9, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    leg.position.set(x + dx, 0.45, z + 0.55);
    leg.castShadow = true;
    scene.add(leg);
  }

  const monitor = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.82, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x111827 })
  );
  monitor.position.set(x, 1.65, z + 0.72);
  monitor.castShadow = true;
  scene.add(monitor);
}

export default function ThreeOffice({
  agents,
  selectedId,
  onSelect
}: {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    const container = host;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.Fog(0x070b14, 24, 48);

    const camera = new THREE.OrthographicCamera(-11, 11, 7, -7, 0.1, 100);
    camera.position.set(15, 16, 15);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.7, 0);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.minZoom = 0.65;
    controls.maxZoom = 2.2;
    controls.minPolarAngle = 0.72;
    controls.maxPolarAngle = 1.18;
    controls.minAzimuthAngle = Math.PI / 8;
    controls.maxAzimuthAngle = Math.PI * 0.72;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xbad7ff, 0x172033, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(8, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.35, 15),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.94 })
    );
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
    grid.position.y = 0.005;
    scene.add(grid);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(20, 4.8, 0.25), wallMaterial);
    backWall.position.set(0, 2.4, -7.35);
    backWall.receiveShadow = true;
    scene.add(backWall);
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.8, 15), wallMaterial);
    sideWall.position.set(-10.1, 2.4, 0);
    sideWall.receiveShadow = true;
    scene.add(sideWall);

    // Meeting zone is intentionally simple: this is a control-plane visualization, not a game map.
    const meetingTable = new THREE.Mesh(
      new THREE.CylinderGeometry(2.15, 2.15, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 })
    );
    meetingTable.position.set(-4.8, 0.85, 4.35);
    meetingTable.castShadow = true;
    scene.add(meetingTable);

    const interactive: THREE.Object3D[] = [];
    const animated: Array<{ group: THREE.Group; status: AgentStatus; phase: number }> = [];

    for (const agent of agents) {
      addDesk(scene, agent.seatX, agent.seatZ);

      const group = new THREE.Group();
      group.position.set(agent.seatX, 0, agent.seatZ - 0.75);
      group.userData.agentId = agent.id;

      const color = statusColor(agent.status);
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.42, 0.72, 5, 10),
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.55,
          emissive: selectedId === agent.id ? color : 0x000000,
          emissiveIntensity: selectedId === agent.id ? 0.23 : 0
        })
      );
      body.position.y = 1.08;
      body.castShadow = true;
      body.userData.agentId = agent.id;

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 18, 14),
        new THREE.MeshStandardMaterial({ color: 0xf1c9a7, roughness: 0.72 })
      );
      head.position.y = 1.92;
      head.castShadow = true;
      head.userData.agentId = agent.id;

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.055, 10, 40),
        new THREE.MeshBasicMaterial({ color })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.08;
      ring.userData.agentId = agent.id;

      group.add(body, head, ring, labelSprite(agent));
      scene.add(group);
      interactive.push(body, head, ring);
      animated.push({ group, status: agent.status, phase: Math.random() * Math.PI * 2 });
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function handleClick(event: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(interactive, false)[0];
      const id = hit?.object.userData.agentId as string | undefined;
      if (id) onSelect(id);
    }

    renderer.domElement.addEventListener("click", handleClick);

    function resize() {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      const aspect = width / height;
      const size = 8.8;
      camera.left = -size * aspect;
      camera.right = size * aspect;
      camera.top = size;
      camera.bottom = -size;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    const clock = new THREE.Clock();
    function animate() {
      frame = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      for (const item of animated) {
        if (item.status === "working") {
          item.group.position.y = Math.sin(time * 4 + item.phase) * 0.05;
        } else if (item.status === "meeting") {
          item.group.rotation.y = Math.sin(time * 1.4 + item.phase) * 0.08;
        }
      }
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("click", handleClick);
      controls.dispose();
      scene.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          object.geometry?.dispose?.();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose?.();
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [agents, selectedId, onSelect]);

  return <div className="three-office" ref={mountRef} />;
}
