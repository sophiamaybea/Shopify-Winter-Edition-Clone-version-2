"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AnimatePresence, motion } from "framer-motion";
import styles from "./WritingRoomWorld.module.css";

type Course = {
  no: string;
  title: string;
  craft: string;
  kind: string;
  artifact: string;
  stamp: string;
  blurb: string;
};

const COURSES: Course[] = [
  {
    no: "01",
    title: "THE NIGHT CLERK'S REGISTRY",
    craft: "REVISION",
    kind: "MOTEL REGISTRY CARD",
    artifact: "/wrb/course-artifacts/01_night-clerks-registry.svg",
    stamp: "/wrb/course-stamps/01_night-clerks-registry_stamp.svg",
    blurb: "A revision room built around evidence, contradiction, omission and the sharper second look.",
  },
  {
    no: "02",
    title: "THE CORRESPONDENCE SOCIETY",
    craft: "VOICE",
    kind: "MEMBERSHIP / MAIL CARD",
    artifact: "/wrb/course-artifacts/02_correspondence-society.svg",
    stamp: "/wrb/course-stamps/02_correspondence-society_stamp.svg",
    blurb: "Voice through address, intimacy, rhythm, distance and the letter that changes because somebody specific is receiving it.",
  },
  {
    no: "03",
    title: "THE DINING-ROOM DIALOGUE",
    craft: "DIALOGUE",
    kind: "RESERVATION CHIT",
    artifact: "/wrb/course-artifacts/03_dining-room-dialogue.svg",
    stamp: "/wrb/course-stamps/03_dining-room-dialogue_stamp.svg",
    blurb: "Dialogue as appetite and friction: interruption, evasion, status, subtext and what sits on the table between two people.",
  },
  {
    no: "04",
    title: "THE ALPINE HOTEL LEDGER",
    craft: "PLOTTING",
    kind: "HOTEL FOLIO / KEY TAG",
    artifact: "/wrb/course-artifacts/04_alpine-hotel-ledger.svg",
    stamp: "/wrb/course-stamps/04_alpine-hotel-ledger_stamp.svg",
    blurb: "Plot as an occupied building: arrivals, exits, collisions, escalation and consequences.",
  },
  {
    no: "05",
    title: "THE AIRBORNE STORY PERMIT",
    craft: "CHARACTERS",
    kind: "BOARDING PASS",
    artifact: "/wrb/course-artifacts/05_airborne-story-permit.svg",
    stamp: "/wrb/course-stamps/05_airborne-story-permit_stamp.svg",
    blurb: "Character through baggage, route, contradiction, behaviour and what a person reveals in transit.",
  },
  {
    no: "06",
    title: "THE PROGRAMME OF UNMADE PICTURES",
    craft: "SCENEWRITING",
    kind: "CINEMA TICKET",
    artifact: "/wrb/course-artifacts/06_programme-unmade-pictures.svg",
    stamp: "/wrb/course-stamps/06_programme-unmade-pictures_stamp.svg",
    blurb: "Scenewriting through entrance, exit, object, gesture, pressure and the moment after which the room is changed.",
  },
];

function roughPaperTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = 214 + Math.floor(Math.random() * 35);
    image.data[i] = n;
    image.data[i + 1] = n - 5;
    image.data[i + 2] = n - 12;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

export function WritingRoomWorld() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const course = useMemo(() => (selected == null ? null : COURSES[selected]), [selected]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x2b1916, 0.023);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 8.8, 11.2);
    camera.lookAt(0, 0, 0.15);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = styles.canvas;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D writing course desk");
    renderer.domElement.setAttribute("role", "img");
    mount.appendChild(renderer.domElement);

    const world = new THREE.Group();
    world.rotation.x = -0.015;
    scene.add(world);

    const desk = new THREE.Mesh(
      new THREE.PlaneGeometry(25, 17),
      new THREE.MeshStandardMaterial({ color: 0x4b2d27, roughness: 0.67, metalness: 0.01 })
    );
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -0.34;
    desk.receiveShadow = true;
    world.add(desk);

    const blotter = new THREE.Mesh(
      new THREE.PlaneGeometry(17.2, 10.4),
      new THREE.MeshStandardMaterial({ color: 0x263d36, roughness: 0.89, metalness: 0 })
    );
    blotter.rotation.x = -Math.PI / 2;
    blotter.position.y = -0.315;
    blotter.position.z = 0.2;
    blotter.receiveShadow = true;
    world.add(blotter);

    const paperNoise = roughPaperTexture();
    if (paperNoise) {
      const mat = blotter.material as THREE.MeshStandardMaterial;
      mat.roughnessMap = paperNoise;
      mat.bumpMap = paperNoise;
      mat.bumpScale = 0.015;
    }

    const hemi = new THREE.HemisphereLight(0xfff0d5, 0x1d2028, 1.25);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffe4b8, 3.0);
    key.position.set(-5.5, 9.5, 5.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.0005;
    scene.add(key);

    const redPractical = new THREE.PointLight(0xb3493e, 10, 14, 2.2);
    redPractical.position.set(7.2, 3.2, -4.5);
    scene.add(redPractical);

    const warmPractical = new THREE.PointLight(0xffbf78, 7, 12, 2);
    warmPractical.position.set(-7.5, 2.5, 4.6);
    scene.add(warmPractical);

    const stampBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.66, 0.18, 48),
      new THREE.MeshStandardMaterial({ color: 0x7c2e2b, roughness: 0.48, metalness: 0.04 })
    );
    stampBase.position.set(6.9, -0.02, 4.4);
    stampBase.castShadow = true;
    world.add(stampBase);

    const stampHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.25, 1.1, 36),
      new THREE.MeshStandardMaterial({ color: 0x2a1917, roughness: 0.36, metalness: 0.02 })
    );
    stampHandle.position.set(6.9, 0.56, 4.4);
    stampHandle.castShadow = true;
    world.add(stampHandle);

    const paperWeight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.17, 64),
      new THREE.MeshPhysicalMaterial({
        color: 0xe4a54a,
        roughness: 0.22,
        metalness: 0.72,
        clearcoat: 0.55,
        clearcoatRoughness: 0.2,
      })
    );
    paperWeight.position.set(-7.4, -0.03, -4.55);
    paperWeight.castShadow = true;
    world.add(paperWeight);

    const loader = new THREE.TextureLoader();
    const cardMeshes: THREE.Mesh[] = [];
    const cardGroups: THREE.Group[] = [];
    const basePositions = [
      [-4.75, 2.25, -0.055],
      [0, 2.25, 0.03],
      [4.75, 2.25, -0.035],
      [-4.75, -1.55, 0.04],
      [0, -1.55, -0.025],
      [4.75, -1.55, 0.05],
    ] as const;
    const baseRotations = [-0.055, 0.045, -0.035, 0.04, -0.03, 0.055];

    let disposed = false;
    Promise.all(
      COURSES.map(async (item, index) => {
        const texture = await loader.loadAsync(item.artifact);
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const side = new THREE.MeshStandardMaterial({
          color: index === 1 ? 0xd3a3a5 : index === 5 ? 0xd18f4c : 0xdfd0b7,
          roughness: 0.9,
          metalness: 0,
        });
        const front = new THREE.MeshPhysicalMaterial({
          map: texture,
          roughness: 0.79,
          metalness: 0,
          clearcoat: 0.04,
          clearcoatRoughness: 0.9,
        });
        const back = new THREE.MeshStandardMaterial({ color: 0xbcae96, roughness: 0.92 });
        const materials = [side, side, side, side, front, back];
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.33, 0.085, 1, 1, 1), materials);
        mesh.rotation.x = -Math.PI / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.courseIndex = index;

        const group = new THREE.Group();
        const [x, z, y] = basePositions[index];
        group.position.set(x, y, z);
        group.rotation.y = baseRotations[index];
        group.userData.baseY = y;
        group.userData.baseRotation = baseRotations[index];
        group.userData.lift = 0;
        group.add(mesh);
        world.add(group);
        cardMeshes[index] = mesh;
        cardGroups[index] = group;
      })
    ).then(() => {
      if (!disposed) setReady(true);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(9, 9);
    let hovered = -1;
    let dragging = false;
    let dragStartX = 0;
    let dragStartRotation = 0;
    let targetWorldRotation = 0;
    let targetCameraX = 0;
    let targetCameraZ = 11.2;

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      targetCameraX = pointer.x * 0.48;
      targetCameraZ = 11.2 + Math.max(0, pointer.y) * 0.22;
      if (dragging) {
        targetWorldRotation = dragStartRotation + (event.clientX - dragStartX) * 0.0017;
      }
    };

    const onMove = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(cardMeshes.filter(Boolean), false);
      hovered = hits.length ? Number(hits[0].object.userData.courseIndex) : -1;
      renderer.domElement.style.cursor = dragging ? "grabbing" : hovered >= 0 ? "pointer" : "grab";
    };
    const onDown = (event: PointerEvent) => {
      updatePointer(event);
      dragging = true;
      dragStartX = event.clientX;
      dragStartRotation = targetWorldRotation;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      const moved = Math.abs(event.clientX - dragStartX);
      dragging = false;
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      if (moved < 8 && hovered >= 0) setSelected(hovered);
    };
    const onLeave = () => {
      hovered = -1;
      dragging = false;
      pointer.set(9, 9);
      targetCameraX = 0;
      targetCameraZ = 11.2;
    };

    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      const t = clock.getElapsedTime();
      world.rotation.y += (targetWorldRotation - world.rotation.y) * 0.055;
      camera.position.x += (targetCameraX - camera.position.x) * 0.035;
      camera.position.z += (targetCameraZ - camera.position.z) * 0.035;
      camera.lookAt(0, 0, 0.15);

      cardGroups.forEach((group, index) => {
        if (!group) return;
        const active = index === hovered;
        const targetLift = active ? 0.48 : 0;
        group.userData.lift += (targetLift - group.userData.lift) * (reduceMotion ? 1 : 0.12);
        group.position.y = group.userData.baseY + group.userData.lift;
        const wobble = reduceMotion ? 0 : Math.sin(t * 0.85 + index * 1.7) * 0.004;
        group.rotation.y += (group.userData.baseRotation + wobble - group.rotation.y) * 0.055;
        group.rotation.z += ((active ? pointer.x * -0.025 : 0) - group.rotation.z) * 0.08;
        group.scale.lerp(new THREE.Vector3(active ? 1.035 : 1, active ? 1.035 : 1, active ? 1.035 : 1), 0.08);
      });

      stampHandle.rotation.z = reduceMotion ? 0 : Math.sin(t * 0.7) * 0.018;
      paperWeight.rotation.y = t * 0.08;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
              material.map?.dispose();
              material.bumpMap?.dispose();
              material.roughnessMap?.dispose();
            }
            material.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      setReady(false);
    };
  }, []);

  return (
    <section className={styles.host} aria-labelledby="wrb-world-title">
      <div className={styles.light} aria-hidden="true" />
      <div className={styles.copyBlock}>
        <p className={styles.eyebrow}>THE WRITING ROOM BUREAU • AUTUMN TERM</p>
        <h1 id="wrb-world-title">Six rooms.<br />One writing life.</h1>
        <p className={styles.lede}>
          A tactile course bureau built from registries, letters, reservation slips,
          hotel ledgers, boarding passes and cinema tickets.
        </p>
        <div className={styles.instructions}>
          <span>DRAG THE DESK</span><span>HOVER TO LIFT</span><span>CLICK TO OPEN</span>
        </div>
      </div>

      <div className={styles.sceneWrap} ref={mountRef}>
        {!ready ? <div className={styles.loading}>ASSEMBLING PAPER WORLD…</div> : null}
      </div>

      <div className={styles.cornerLabel} aria-hidden="true">
        <span>WRB</span><b>26</b>
      </div>

      <AnimatePresence>
        {course ? (
          <motion.aside
            className={styles.drawer}
            initial={{ x: "105%" }}
            animate={{ x: 0 }}
            exit={{ x: "105%" }}
            transition={{ type: "spring", stiffness: 240, damping: 28 }}
          >
            <button className={styles.close} onClick={() => setSelected(null)} aria-label="Close course">×</button>
            <img className={styles.drawerTicket} src={course.artifact} alt="" aria-hidden="true" />
            <p className={styles.drawerMeta}>COURSE {course.no} • {course.kind}</p>
            <h2>{course.title}</h2>
            <p className={styles.drawerCraft}>{course.craft}</p>
            <p className={styles.drawerBlurb}>{course.blurb}</p>
            <img className={styles.drawerStamp} src={course.stamp} alt="" aria-hidden="true" />
            <button className={styles.enter}>ENTER THIS ROOM</button>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
