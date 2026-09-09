"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import styles from "./WritingRoomBureauCourses.module.css";

const ARTIFACTS = [
  "/wrb/course-artifacts/01_night-clerks-registry.svg",
  "/wrb/course-artifacts/02_correspondence-society.svg",
  "/wrb/course-artifacts/03_dining-room-dialogue.svg",
  "/wrb/course-artifacts/04_alpine-hotel-ledger.svg",
  "/wrb/course-artifacts/05_airborne-story-permit.svg",
  "/wrb/course-artifacts/06_programme-unmade-pictures.svg",
];

const ACCENTS = [0x8f3c35, 0x7d3544, 0x914330, 0x863f35, 0x934137, 0x682331];

function makePaper(
  texture: THREE.Texture,
  accent: number,
  width = 3.15,
  height = 1.99
) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const face = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.86,
    metalness: 0,
    clearcoat: 0.02,
    clearcoatRoughness: 0.8,
  });
  const back = new THREE.MeshPhysicalMaterial({
    color: 0xe9dfca,
    roughness: 0.98,
  });
  const edge = new THREE.MeshStandardMaterial({
    color: 0xd3c5aa,
    roughness: 1,
  });

  const geometry = new THREE.BoxGeometry(width, height, 0.075, 1, 1, 2);
  const mesh = new THREE.Mesh(geometry, [edge, edge, edge, edge, face, back]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 30),
    new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.18 })
  );
  outline.scale.setScalar(1.002);
  mesh.add(outline);

  return mesh;
}

function makeHotelKey() {
  const group = new THREE.Group();
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0x9e6b3d,
    metalness: 0.72,
    roughness: 0.34,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.075, 18, 48), metal);
  ring.castShadow = true;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.5, 0.09), metal);
  shaft.position.y = -0.84;
  shaft.castShadow = true;
  const toothA = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.09), metal);
  toothA.position.set(0.12, -1.53, 0);
  toothA.castShadow = true;
  const toothB = toothA.clone();
  toothB.scale.x = 0.62;
  toothB.position.set(-0.02, -1.72, 0);
  group.add(ring, shaft, toothA, toothB);
  group.rotation.z = -0.55;
  return group;
}

function makeStamp() {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x684638, roughness: 0.82 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x73332e, roughness: 0.94 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.18, 36), rubber);
  base.castShadow = true;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.7, 24), wood);
  stem.position.y = 0.43;
  stem.castShadow = true;
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 18), wood);
  handle.scale.y = 0.72;
  handle.position.y = 0.9;
  handle.castShadow = true;
  group.add(base, stem, handle);
  group.rotation.x = -0.18;
  return group;
}

function makePen() {
  const group = new THREE.Group();
  const barrel = new THREE.MeshPhysicalMaterial({
    color: 0x352b29,
    roughness: 0.28,
    metalness: 0.2,
    clearcoat: 0.28,
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb98946, metalness: 0.68, roughness: 0.34 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 2.35, 24), barrel);
  body.castShadow = true;
  const nib = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 18), brass);
  nib.position.y = -1.36;
  nib.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.48, 24), brass);
  cap.position.y = 1.4;
  cap.castShadow = true;
  group.add(body, nib, cap);
  group.rotation.z = Math.PI * 0.37;
  return group;
}

function makeEnvelope() {
  const group = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: 0xeee2cc, roughness: 0.96, side: THREE.DoubleSide });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.08, 0.045), paper);
  base.castShadow = true;
  const shape = new THREE.Shape();
  shape.moveTo(-0.9, 0.52);
  shape.lineTo(0.9, 0.52);
  shape.lineTo(0, -0.16);
  shape.closePath();
  const flap = new THREE.Mesh(new THREE.ShapeGeometry(shape), paper);
  flap.position.z = 0.04;
  flap.castShadow = true;
  group.add(base, flap);
  return group;
}

function makeDust() {
  const count = 130;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 15;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 9;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aPhase;
      void main(){
        vec3 p = position;
        p.y += sin(uTime * .34 + aPhase) * .16;
        p.x += cos(uTime * .22 + aPhase) * .09;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_PointSize = (2.2 + sin(aPhase + uTime) * .7) * uPixelRatio * (9.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      void main(){
        float d = distance(gl_PointCoord, vec2(.5));
        float a = smoothstep(.5,.12,d) * .22;
        gl_FragColor = vec4(.33,.24,.18,a);
      }
    `,
  });
  return { points: new THREE.Points(geometry, material), material };
}

export function WritingRoomBureauThree() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf3e7d3, 0.032);
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 60);
    camera.position.set(0, 0.25, 12.5);

    const bureau = new THREE.Group();
    bureau.rotation.x = -0.03;
    scene.add(bureau);

    const hemi = new THREE.HemisphereLight(0xfff4df, 0x604c40, 2.35);
    scene.add(hemi);
    const keyLight = new THREE.DirectionalLight(0xffe8c9, 4.1);
    keyLight.position.set(-3.5, 6.5, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 26;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    scene.add(keyLight);
    const pointerLight = new THREE.PointLight(0xfff0d5, 18, 14, 2);
    pointerLight.position.set(0, 2, 6);
    scene.add(pointerLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 11),
      new THREE.ShadowMaterial({ color: 0x4a3328, opacity: 0.2 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.15;
    floor.position.z = -0.2;
    floor.receiveShadow = true;
    scene.add(floor);

    const loader = new THREE.TextureLoader();
    const paperMeshes: THREE.Mesh[] = [];
    const positions = [
      [-3.55, 1.55, -0.3, -0.12],
      [0, 1.65, -0.85, 0.075],
      [3.58, 1.35, -0.45, 0.12],
      [-3.4, -1.22, -0.6, 0.09],
      [0.1, -1.15, -0.15, -0.07],
      [3.55, -1.32, -0.75, -0.1],
    ] as const;

    ARTIFACTS.forEach((src, index) => {
      loader.load(src, (texture) => {
        const paper = makePaper(texture, ACCENTS[index]);
        const [x, y, z, rz] = positions[index];
        paper.position.set(x, y, z);
        paper.rotation.set(index % 2 ? 0.06 : -0.04, index % 2 ? -0.13 : 0.12, rz);
        paper.userData.baseY = y;
        paper.userData.phase = index * 0.87;
        paper.userData.baseRz = rz;
        bureau.add(paper);
        paperMeshes.push(paper);
      });
    });

    const key = makeHotelKey();
    key.position.set(-5.25, -0.28, 0.8);
    key.scale.setScalar(0.88);
    bureau.add(key);

    const stamp = makeStamp();
    stamp.position.set(5.18, 0.15, 0.9);
    stamp.rotation.z = -0.45;
    stamp.scale.setScalar(0.88);
    bureau.add(stamp);

    const pen = makePen();
    pen.position.set(4.92, -2.55, 1.05);
    pen.scale.setScalar(0.9);
    bureau.add(pen);

    const envelope = makeEnvelope();
    envelope.position.set(-4.85, 2.8, -0.2);
    envelope.rotation.set(-0.12, 0.22, -0.35);
    bureau.add(envelope);

    const { points: dust, material: dustMaterial } = makeDust();
    scene.add(dust);

    let width = 1;
    let height = 1;
    const resize = () => {
      width = Math.max(1, wrap.clientWidth);
      height = Math.max(1, wrap.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const onPointer = (event: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      pointerTarget.x = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
      pointerTarget.y = THREE.MathUtils.clamp(-((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let gsapCleanup = () => {};
    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      gsap.registerPlugin(ScrollTrigger);
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap,
          start: "top bottom",
          end: "bottom top",
          scrub: reduced ? false : 1,
        },
      });
      tl.fromTo(bureau.rotation, { y: -0.11 }, { y: 0.13, ease: "none" }, 0)
        .fromTo(bureau.position, { y: -0.12 }, { y: 0.22, ease: "none" }, 0)
        .fromTo(camera.position, { z: 12.9 }, { z: 11.5, ease: "none" }, 0);
      gsapCleanup = () => {
        tl.scrollTrigger?.kill();
        tl.kill();
      };
    })();

    const clock = new THREE.Clock();
    let raf = 0;
    const render = () => {
      const t = clock.getElapsedTime();
      pointer.lerp(pointerTarget, 0.055);
      pointerLight.position.x = pointer.x * 5.8;
      pointerLight.position.y = pointer.y * 3.2 + 1.3;
      camera.rotation.y += ((pointer.x * 0.045) - camera.rotation.y) * 0.05;
      camera.rotation.x += ((pointer.y * 0.025) - camera.rotation.x) * 0.05;
      bureau.rotation.z += ((pointer.x * -0.018) - bureau.rotation.z) * 0.035;

      if (!reduced) {
        for (const paper of paperMeshes) {
          const phase = Number(paper.userData.phase ?? 0);
          const baseY = Number(paper.userData.baseY ?? paper.position.y);
          paper.position.y = baseY + Math.sin(t * 0.72 + phase) * 0.055;
          paper.rotation.z = Number(paper.userData.baseRz ?? 0) + Math.sin(t * 0.48 + phase) * 0.008;
        }
        key.rotation.y = Math.sin(t * 0.42) * 0.18;
        stamp.rotation.y = Math.sin(t * 0.55 + 1.5) * 0.18;
        envelope.rotation.y = 0.22 + Math.sin(t * 0.35) * 0.08;
      }
      dustMaterial.uniforms.uTime.value = t;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      ro.disconnect();
      gsapCleanup();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrapRef} className={styles.stage3d} data-wrb-three>
      <canvas ref={canvasRef} className={styles.stageCanvas} aria-hidden="true" />
      <div className={styles.stageLegend} aria-hidden="true">
        <span>PHYSICAL ARCHIVE / 06 ACTIVE FILES</span>
        <span>MOVE CURSOR TO RELIGHT THE DESK</span>
      </div>
    </div>
  );
}
