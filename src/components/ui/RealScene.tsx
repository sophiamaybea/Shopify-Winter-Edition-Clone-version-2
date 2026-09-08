"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  evalObjectAt,
  getSequenceLength,
  getStaticObjectValues,
  getStaticStringValue,
  hasAnimatedTrack,
  type TheatreProjectState,
} from "@/lib/theatreTrack";
import {
  scenes,
  type SceneAsset,
  type SceneDefinition,
  type SceneId,
} from "@/data/scenes";

gsap.registerPlugin(ScrollTrigger);

// Reconstructed from the production Particles component in
// Butterflies-BqVLbn8p.js. Keeping the motion in the vertex shader avoids
// uploading 600 changing positions every frame.
const particleVertexShader = `
attribute vec3 velocity;
attribute float phase;
attribute float sizeScale;

uniform float uSize;
uniform float uSizeVariation;
uniform float uTime;
uniform float uSpeed;
uniform float uTurbulence;
uniform float uBlinkSpeed;
uniform float uBlinkMin;
uniform sampler2D tNoise;

varying float vAlpha;

float sampleNoise(vec2 uv) {
  return texture2D(tNoise, uv).r * 2.0 - 1.0;
}

void main() {
  vec3 animatedPos = position + velocity * uTime * uSpeed * 0.01;
  animatedPos = fract(animatedPos * 0.5 + 0.5) * 2.0 - 1.0;

  if (uTurbulence > 0.0) {
    vec3 noisePos = position * 2.0 + uTime * 0.1;
    animatedPos.x += sampleNoise(noisePos.xy * 0.125) * uTurbulence * 0.1;
    animatedPos.y += sampleNoise(noisePos.yz * 0.125) * uTurbulence * 0.1;
    animatedPos.z += sampleNoise(noisePos.zx * 0.125) * uTurbulence * 0.1;
  }

  vec4 mvPosition = modelViewMatrix * vec4(animatedPos, 1.0);
  float variationScale = mix(1.0, sizeScale, uSizeVariation);
  gl_PointSize = uSize * variationScale * (200.0 / -mvPosition.z);

  float blinkWave = sin(uTime * uBlinkSpeed + phase) * 0.5 + 0.5;
  float blink = uBlinkSpeed > 0.0
    ? uBlinkMin + (1.0 - uBlinkMin) * blinkWave
    : 1.0;
  vAlpha = blink;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const particleFragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBlur;
varying float vAlpha;

void main() {
  vec2 center = gl_PointCoord * 2.0 - 1.0;
  float dist = 1.0 - min(1.0, length(center));
  float blur = 1.0 - pow(uBlur, 2.0);
  float alphaFalloff = smoothstep(0.0, blur, dist);
  gl_FragColor = vec4(uColor, uOpacity * alphaFalloff * vAlpha);
}
`;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/assets/3d/decoders/draco/");

let sharedKtx2Loader: KTX2Loader | null = null;
function getKtx2Loader(renderer: THREE.WebGLRenderer) {
  if (!sharedKtx2Loader) {
    sharedKtx2Loader = new KTX2Loader();
    sharedKtx2Loader.setTranscoderPath("/assets/3d/decoders/basis/");
  }
  sharedKtx2Loader.detectSupport(renderer);
  return sharedKtx2Loader;
}

/**
 * The production scene loader does not render an emissive GLTF material as
 * PBR. It promotes the emissive texture to the diffuse map of a white,
 * unlit material instead. Keep this normalization separate from loading so
 * the same source-material contract can be reused by another compositor.
 */
function normalizeEmissiveMaterials(root: THREE.Object3D) {
  const replacements = new Map<THREE.Material, THREE.Material>();
  let converted = 0;

  const normalize = (material: THREE.Material) => {
    const cached = replacements.get(material);
    if (cached) return cached;

    let replacement: THREE.Material = material;
    if (
      material instanceof THREE.MeshStandardMaterial &&
      material.emissiveMap
    ) {
      replacement = new THREE.MeshBasicMaterial({
        map: material.emissiveMap ?? material.map,
        opacity: material.opacity,
        transparent: material.transparent,
        alphaTest: material.alphaTest,
        side: material.side,
      });
      replacement.name = material.name;
      converted += 1;
    }
    replacements.set(material, replacement);
    return replacement;
  };

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(normalize)
      : normalize(object.material);
  });

  for (const [original, replacement] of replacements) {
    if (original !== replacement) original.dispose();
  }
  return converted;
}

function disposeMaterialResources(
  material: THREE.Material,
  disposedTextures: Set<THREE.Texture>
) {
  const disposeTexture = (value: unknown) => {
    if (!(value instanceof THREE.Texture) || disposedTextures.has(value)) return;
    disposedTextures.add(value);
    value.dispose();
  };

  for (const value of Object.values(material)) disposeTexture(value);
  if (material instanceof THREE.ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      disposeTexture(uniform?.value);
    }
  }
  material.dispose();
}

function disposeObjectResources(
  root: THREE.Object3D,
  disposedTextures = new Set<THREE.Texture>()
) {
  const disposedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (disposedMaterials.has(material)) continue;
        disposedMaterials.add(material);
        disposeMaterialResources(material, disposedTextures);
      }
    }
    if (object instanceof THREE.SkinnedMesh) {
      const boneTexture = object.skeleton.boneTexture;
      if (boneTexture && !disposedTextures.has(boneTexture)) {
        disposedTextures.add(boneTexture);
        boneTexture.dispose();
      }
    }
  });
  return disposedTextures;
}

interface RealSceneProps {
  sceneId?: SceneId;
  assets?: SceneAsset[];
  model?: string;
  extraModels?: string[];
  /** A real 3D-positioned background plane mesh (KTX2 texture embedded in
   * the GLB itself) — gives authentic camera-relative parallax against the
   * foreground, unlike a flat `background` texture locked to the camera. */
  backgroundModel?: string;
  theatre?: string;
  background?: string;
  environment?: string;
  customCameraName?: string;
  sequenceStart?: number;
  scrollTarget?: string;
  className?: string;
}

export function RealScene({
  sceneId,
  assets,
  model,
  extraModels,
  backgroundModel,
  theatre,
  background,
  environment,
  customCameraName,
  sequenceStart,
  scrollTarget,
  className = "",
}: RealSceneProps) {
  const definition: SceneDefinition | undefined = sceneId
    ? scenes[sceneId]
    : undefined;
  const orderedAssets =
    assets ??
    definition?.assets ??
    (model
      ? [
          { kind: "model" as const, src: model },
          ...(background
            ? [{ kind: "texture" as const, src: background }]
            : []),
          ...(extraModels ?? []).map((src) => ({
            kind: "model" as const,
            src,
          })),
        ]
      : []);
  const theatrePath = theatre ?? definition?.theatre;
  const environmentPath = environment ?? definition?.environment;
  const namedCamera = customCameraName ?? definition?.customCameraName;
  const timelineStart = sequenceStart ?? definition?.sequenceStart ?? 0;
  const earlyCrossfade = definition?.earlyCrossfade ?? 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const darkenRef = useRef<HTMLDivElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [renderEpoch, setRenderEpoch] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPortalHost(document.getElementById("scene-portal"));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observed =
      (scrollTarget && document.querySelector(scrollTarget)) || el;
    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { rootMargin: "50% 0px 50% 0px" }
    );
    observer.observe(observed);
    return () => observer.disconnect();
  }, [portalHost, scrollTarget]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    container.dataset.sceneStatus = "loading";
    if (darkenRef.current) darkenRef.current.style.opacity = "0";

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;

    const width = container.offsetWidth;
    const height = container.offsetHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 1000);
    camera.position.set(0, 0, 4);

    // The source renderer uses a post-process antialiasing pass. Native MSAA
    // needlessly increases memory for every lazily mounted scene context.
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    // Several chapters overlap during their crossfade. At a Retina DPR of 2,
    // two full-viewport EffectComposers allocate enough render-target memory
    // to make Chrome evict a context around Retail. The production compositor
    // uses adaptive resolution; mirror that behaviour here.
    const pixelRatio = Math.min(
      window.devicePixelRatio,
      window.innerWidth >= 1400 ? 1.25 : 1.5
    );
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The source renders through React Three Fiber, whose color pipeline uses
    // ACES filmic tone mapping. Raw Three.js defaults to NoToneMapping, which
    // made the PBR-heavy chapters from Marketing onward appear nearly black
    // even though their models, Theatre state and PMREM environment loaded.
    // Production still configures the R3F renderer with ACES, but Hero renders
    // to a half-float post target. Materials are not tone-mapped offscreen and
    // the final EffectMaterial performs only the sRGB transfer.
    renderer.toneMapping =
      sceneId === "hero"
        ? THREE.NoToneMapping
        : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    container.appendChild(renderer.domElement);

    // Match the chapters whose source Theatre state authors bloom. The old
    // implementation disabled every compositor after Retail to work around
    // leaked GPU resources, which also removed the authored light from
    // Checkout, Finance, Shipping and Developer. Resource teardown below now
    // releases the render targets and their textures correctly.
    const usesPostprocessing = [
      "hero",
      "sidekick",
      "agentic",
      "online",
      "retail",
      "checkout",
      "finance",
      "shipping",
      "developer",
    ].includes(sceneId ?? "");
    const composer = usesPostprocessing ? new EffectComposer(renderer) : null;
    let bloomPass: UnrealBloomPass | null = null;
    if (composer) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0,
        sceneId === "hero" ? 0.85 : 0.25,
        sceneId === "hero" ? 1 : 0.9
      );
      if (sceneId === "hero") {
        // BloomEffect uses SCREEN rather than UnrealBloomPass's additive copy.
        // These factors implement src + dst - src*dst for the settled Hero's
        // normalized color range.
        bloomPass.blendMaterial.blending = THREE.CustomBlending;
        bloomPass.blendMaterial.blendEquation = THREE.AddEquation;
        bloomPass.blendMaterial.blendSrc = THREE.OneMinusDstColorFactor;
        bloomPass.blendMaterial.blendDst = THREE.OneFactor;
      }
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      if (disposed) return;
      container!.dataset.sceneStatus = "context-lost";
      // Recreate only this scene's renderer. This also recovers an already
      // open tab after Chrome has reclaimed a WebGL context.
      setRenderEpoch((epoch) => epoch + 1);
    }
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    // The source fades each loaded asset from its placeholder over 400ms.
    // Fading the canvas is the closest equivalent without its custom material.
    if (!reduce) {
      renderer.domElement.style.opacity = "0";
      renderer.domElement.style.transition = "opacity 400ms ease-in-out";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (disposed) return;
          renderer.domElement.style.opacity = "1";
        });
      });
    }

    // Base camera position/rotation come from the scroll-scrubbed theatre
    // sequence; a small pointer-driven offset is added on top each frame so
    // the two never fight over camera.position directly.
    const baseCam = { x: 0, y: 0, z: 4 };
    const baseRotation = { x: 0, y: 0, z: 0 };
    const pointerOffset = { x: 0, y: 0 };
    const pointerTarget = { x: 0, y: 0 };
    function onPointerMove(e: PointerEvent) {
      if (reduce) return;
      const rect = container!.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      pointerTarget.x = nx * 2;
      pointerTarget.y = -ny * 2;
    }
    function onPointerLeave() {
      pointerTarget.x = 0;
      pointerTarget.y = 0;
    }
    // The compositor itself intentionally has pointer-events:none. The source
    // camera listens at viewport level, so bind globally as well; otherwise
    // the gaze/head response can never receive a pointer event.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);

    const pointLights = [
      {
        key: "light-1",
        light: new THREE.PointLight(
          0xff0000,
          sceneId === "hero" ? 1 : 0,
          10
        ),
      },
      {
        key: "light-2",
        light: new THREE.PointLight(
          0x0000ff,
          sceneId === "hero" ? 1 : 0,
          10
        ),
      },
    ];
    pointLights[0].light.position.set(-0.5, 0, 0.5);
    pointLights[1].light.position.set(0.5, 0, 0.5);
    pointLights.forEach(({ light }) => scene.add(light));

    // Keep a neutral safety rig until the PMREM environment has decoded.
    // The production renderer's HDR pipeline supplies substantially more
    // ambient energy than this standalone EffectComposer. Removing these
    // lights made PBR-only figures (Finance, Shipping, Operations and Retail)
    // render nearly black even though every GLB/KTX request succeeded.
    const safetyAmbient = new THREE.AmbientLight(0xffffff, 0.6);
    const safetyKey = new THREE.DirectionalLight(0xffffff, 1.2);
    safetyKey.position.set(2, 3, 4);
    if (sceneId !== "hero") scene.add(safetyAmbient, safetyKey);

    const ktx2Loader = getKtx2Loader(renderer);
    let environmentTexture: THREE.Texture | null = null;

    if (environmentPath) {
      ktx2Loader.load(environmentPath, (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        environmentTexture = texture;
        scene.environment = texture;
      });
    }

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
    gltfLoader.setKTX2Loader(ktx2Loader);

    let scrollTrigger: ScrollTrigger | null = null;
    let visibilityTrigger: ScrollTrigger | null = null;
    const camState = { t: 0 };
    let heroIntroPosition = sceneId === "hero" ? 0 : timelineStart;
    let heroIntroTween: gsap.core.Tween | null = null;
    const heroScrollOffset = () =>
      Math.max(0, window.scrollY) / Math.max(1, window.innerHeight);

    // Character/prop animations are scroll-scrubbed (like the camera), not
    // played back in real time — motion only advances as the user scrolls,
    // matching the real site's Theatre.js-sequenced behavior.
    const animGroups: {
      key: string;
      mixer: THREE.AnimationMixer;
      actions: THREE.AnimationAction[];
    }[] = [];
    const videoGroups: {
      key: string;
      video: HTMLVideoElement;
    }[] = [];
    const ownedVideos = new Set<HTMLVideoElement>();
    const ownedImages = new Set<HTMLImageElement>();
    const imageAnimationFrames: number[] = [];

    function theatreClipKey(clipName: string) {
      return clipName.replace(/[ .-]/g, "_");
    }

    function scrubAnimationsTo(time: number) {
      for (const { key: objectKey, mixer, actions } of animGroups) {
        const values = theatreState
          ? evalObjectAt(theatreState, objectKey, time)
          : {};
        const staticValues = theatreState
          ? getStaticObjectValues(theatreState, objectKey)
          : {};
        for (const action of actions) {
          const duration = action.getClip().duration || 1;
          const clipName = action.getClip().name;
          const alias = theatreClipKey(clipName);
          const exactProgressPath = `animations.${clipName}.progress`;
          const aliasProgressPath = `animations.${alias}.progress`;
          const progressPath =
            theatreState &&
            hasAnimatedTrack(theatreState, objectKey, exactProgressPath)
              ? exactProgressPath
              : theatreState &&
                  hasAnimatedTrack(theatreState, objectKey, aliasProgressPath)
                ? aliasProgressPath
                : null;
          const staticProgress =
            staticValues[exactProgressPath] ??
            staticValues[aliasProgressPath];
          const loopValue = (staticValues[
            `animations.${clipName}.loop`
          ] ??
            staticValues[
              `animations.${alias}.loop`
            ]) as number | boolean | undefined;
          const loops = loopValue === true || loopValue === 1;

          if (progressPath) {
            action.paused = true;
            const progress = values[progressPath] ?? staticProgress ?? 0;
            action.time = THREE.MathUtils.clamp(progress, 0, 1) * duration;
          } else if (loops) {
            action.paused = false;
            action.enabled = true;
            action.setLoop(THREE.LoopRepeat, Infinity);
            if (!action.isRunning()) action.play();
          } else {
            action.paused = true;
            action.time =
              THREE.MathUtils.clamp(staticProgress ?? 0, 0, 1) * duration;
          }
        }
        mixer.update(0);
      }
      for (const { key, video } of videoGroups) {
        if (!theatreState || !Number.isFinite(video.duration)) continue;
        const values = evalObjectAt(theatreState, key, time);
        const frame = values.frame;
        if (frame === undefined) continue;
        video.currentTime = THREE.MathUtils.clamp(
          frame / 30,
          0,
          Math.max(0, video.duration - 1 / 30)
        );
      }
    }

    // Each background asset gets its own theatre-keyed object ("asset-1",
    // "asset-2", ...) matching backgroundAssets[i] in the real site's data —
    // confirmed from the actual scene component source. We drive each
    // loaded model's position/rotation/visibility from its own track,
    // exactly like the camera.
    const assetObjects: { key: string; object: THREE.Object3D }[] = [];
    let customCameraNode: THREE.Object3D | null = null;
    let particleCloud:
      | {
          points: THREE.Points;
          material: THREE.ShaderMaterial;
        }
      | undefined;
    function applyAssetTransform(key: string, object: THREE.Object3D, time: number) {
      if (!theatreState) return;
      const t = evalObjectAt(theatreState, key, time);
      const responsive = getStaticStringValue(
        theatreState,
        key,
        "responsive"
      );
      const responsiveScale =
        responsive === "cover"
          ? Math.max(1, camera.aspect)
          : responsive === "contain"
            ? Math.min(1, camera.aspect)
            : 1;
      if (t["position.x"] !== undefined) {
        object.position.set(
          (t["position.x"] ?? object.position.x) * responsiveScale,
          (t["position.y"] ?? object.position.y) * responsiveScale,
          t["position.z"] ?? object.position.z
        );
      }
      if (t["rotation.x"] !== undefined) {
        object.rotation.set(
          t["rotation.x"] ?? object.rotation.x,
          t["rotation.y"] ?? object.rotation.y,
          t["rotation.z"] ?? object.rotation.z
        );
      }
      if (t["scale.x"] !== undefined) {
        object.scale.set(
          (t["scale.x"] ?? object.scale.x) * responsiveScale,
          (t["scale.y"] ?? object.scale.y) * responsiveScale,
          (t["scale.z"] ?? object.scale.z) * responsiveScale
        );
      }
      if (t["visibility"] !== undefined) {
        const visibility = THREE.MathUtils.clamp(t["visibility"], 0, 1);
        object.visible = visibility > 0;
        object.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          for (const material of materials) {
            material.transparent = visibility < 1 || material.transparent;
            material.opacity = visibility;
          }
        });
      }
    }

    // The background-plane GLBs are authored at whatever size/depth fit the
    // real site's own camera rig; scale them to cover our camera's frustum
    // at that same depth so they always fill the frame, like a CSS
    // background-size:cover, but as a real 3D-positioned mesh (so it still
    // parallaxes correctly against the foreground as the camera dollies).
    function fitPlaneToCoverFrustum(object: THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      if (size.x <= 0 || size.y <= 0) return;

      const distance = Math.abs(camera.position.z - object.position.z) || 5;
      const vFov = (camera.fov * Math.PI) / 180;
      const visibleHeight = 2 * Math.tan(vFov / 2) * distance;
      const visibleWidth = visibleHeight * camera.aspect;

      const scale = Math.max(visibleWidth / size.x, visibleHeight / size.y) * 1.05;
      object.scale.multiplyScalar(scale);
    }

    function loadModel(path: string, assetKey?: string, isBackgroundPlane = false) {
      gltfLoader.load(
        path,
        (gltf) => {
          if (disposed) {
            disposeObjectResources(gltf.scene);
            return;
          }
          if (sceneId === "hero") {
            container!.dataset.basicMaterialCount = String(
              normalizeEmissiveMaterials(gltf.scene)
            );
          }
          scene.add(gltf.scene);
          container!.dataset.sceneStatus = "ready";
          if (namedCamera && !customCameraNode) {
            customCameraNode =
              gltf.scene.getObjectByName(namedCamera) ?? null;
            // Production uses this node only for world position/quaternion.
            // FOV is owned by the Theatre camera track, while near/far remain
            // the scene-camera defaults. Copying the GLB projection makes the
            // camera briefly disagree with the authored scroll sequence.
          }
          if (isBackgroundPlane) fitPlaneToCoverFrustum(gltf.scene);
          if (gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(gltf.scene);
            const actions = gltf.animations.map((clip) => {
              const action = mixer.clipAction(clip);
              action.play();
              return action;
            });
            mixer.update(0);
            animGroups.push({ key: assetKey ?? "asset-1", mixer, actions });
            scrubAnimationsTo(camState.t);
          }
          if (assetKey) {
            assetObjects.push({ key: assetKey, object: gltf.scene });
            applyAssetTransform(assetKey, gltf.scene, camState.t);
          }
        },
        undefined,
        (error) => {
          if (disposed) return;
          container!.dataset.sceneStatus = "asset-error";
          console.error(`[${sceneId ?? "scene"}] Failed to load ${path}`, error);
        }
      );
    }

    function loadTexturePlane(path: string, assetKey: string) {
      ktx2Loader.load(path, (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        const image = texture.image as { width?: number; height?: number };
        const aspect =
          image.width && image.height ? image.height / image.width : 1;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        plane.scale.set(1, aspect, 1);
        const group = new THREE.Group();
        group.add(plane);
        scene.add(group);
        assetObjects.push({ key: assetKey, object: group });
        applyAssetTransform(assetKey, group, camState.t);
      });
    }

    function loadImagePlane(path: string, assetKey: string) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = path;
      ownedImages.add(img);
      const onReady = () => {
        if (disposed) return;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 1024;
        canvas.height = img.naturalHeight || 1024;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const drawFrame = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          texture.needsUpdate = true;
        };
        drawFrame();
        const animate = () => {
          if (disposed) return;
          drawFrame();
          imageAnimationFrames.push(requestAnimationFrame(animate));
        };
        imageAnimationFrames.push(requestAnimationFrame(animate));
        const aspect =
          canvas.width > 0 ? canvas.height / canvas.width : 1;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        plane.scale.set(1, aspect, 1);
        const group = new THREE.Group();
        group.add(plane);
        scene.add(group);
        assetObjects.push({ key: assetKey, object: group });
        applyAssetTransform(assetKey, group, camState.t);
      };
      if (img.complete && img.naturalWidth > 0) {
        onReady();
      } else {
        img.addEventListener("load", onReady, { once: true });
        img.addEventListener("error", () => {
          if (!disposed) container!.dataset.sceneStatus = "asset-error";
        }, { once: true });
      }
    }

    function loadVideoPlane(
      path: string,
      fallbackPath: string,
      assetKey: string
    ) {
      const video = document.createElement("video");
      video.src = path;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      ownedVideos.add(video);
      const onReady = () => {
        if (disposed) return;
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
        });
        const aspect =
          video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 1;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        plane.scale.set(1, aspect, 1);
        const group = new THREE.Group();
        group.add(plane);
        scene.add(group);
        assetObjects.push({ key: assetKey, object: group });
        videoGroups.push({ key: assetKey, video });
        applyAssetTransform(assetKey, group, camState.t);
        scrubAnimationsTo(camState.t);
      };
      const onError = () => loadTexturePlane(fallbackPath, assetKey);
      video.addEventListener("loadedmetadata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.load();
    }

    function createParticleCloud() {
      if (!theatreState || particleCloud) return;
      const p = getStaticObjectValues(theatreState, "particles");
      if ((p.enabled ?? 0) < 0.5) return;

      const capacity = 1000;
      const count = Math.min(
        capacity,
        Math.max(1, Math.round(p.count ?? 100))
      );
      const positions = new Float32Array(capacity * 3);
      const velocities = new Float32Array(capacity * 3);
      const phases = new Float32Array(capacity);
      const sizeScales = new Float32Array(capacity);
      let seed = 0x9e3779b9;
      const random = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
      };
      for (let i = 0; i < capacity; i++) {
        positions[i * 3] = (random() - 0.5) * 2;
        positions[i * 3 + 1] = (random() - 0.5) * 2;
        positions[i * 3 + 2] = (random() - 0.5) * 2;
        velocities[i * 3] = (random() - 0.5) * 2;
        velocities[i * 3 + 1] = (random() - 0.5) * 2;
        velocities[i * 3 + 2] = (random() - 0.5) * 2;
        phases[i] = random() * Math.PI * 2;
        sizeScales[i] = 0.5 + random();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute(
        "velocity",
        new THREE.BufferAttribute(velocities, 3)
      );
      geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
      geometry.setAttribute(
        "sizeScale",
        new THREE.BufferAttribute(sizeScales, 1)
      );
      geometry.setDrawRange(0, count);

      const noiseSize = 128;
      const noiseData = new Uint8Array(noiseSize * noiseSize * 4);
      for (let i = 0; i < noiseData.length; i += 4) {
        const value = Math.floor(random() * 256);
        noiseData[i] = value;
        noiseData[i + 1] = value;
        noiseData[i + 2] = value;
        noiseData[i + 3] = 255;
      }
      const noiseTexture = new THREE.DataTexture(
        noiseData,
        noiseSize,
        noiseSize,
        THREE.RGBAFormat
      );
      noiseTexture.wrapS = THREE.RepeatWrapping;
      noiseTexture.wrapT = THREE.RepeatWrapping;
      noiseTexture.needsUpdate = true;

      const color = new THREE.Color(
        p["color.r"] ?? 1,
        p["color.g"] ?? 1,
        p["color.b"] ?? 1
      );
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uSize: { value: p.size ?? 0.1 },
          uSizeVariation: { value: p.sizeVariation ?? 0 },
          uColor: { value: color },
          uOpacity: { value: p.opacity ?? 0.6 },
          uBlur: { value: p.blur ?? 0.5 },
          uTime: { value: 0 },
          uSpeed: { value: p.speed ?? 0.5 },
          uTurbulence: { value: p.turbulence ?? 0.2 },
          uBlinkSpeed: { value: p["blink.speed"] ?? 0 },
          uBlinkMin: { value: p["blink.min"] ?? 0.3 },
          tNoise: { value: noiseTexture },
        },
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.scale.set(
        p["scale.x"] ?? 10,
        p["scale.y"] ?? 10,
        p["scale.z"] ?? 10
      );
      points.position.set(
        p["position.x"] ?? 0,
        p["position.y"] ?? 0,
        p["position.z"] ?? -5
      );
      points.frustumCulled = false;
      scene.add(points);
      particleCloud = { points, material };
    }

    function applySceneEffects(time: number) {
      if (!theatreState) return;
      const effects = evalObjectAt(theatreState, "effects", time);
      if (bloomPass) {
        const intensity = Math.max(
          0,
          effects["bloom.intensity"] ?? 0
        );
        // Production assigns Hero's Theatre value directly to BloomEffect.
        // Retain the older approximation only for chapters not audited here.
        bloomPass.strength =
          sceneId === "hero" ? intensity : intensity * 0.12;
      }
      if (darkenRef.current) {
        darkenRef.current.style.opacity = String(
          THREE.MathUtils.clamp(effects["darken.intensity"] ?? 0, 0, 1)
        );
      }
      const particles = evalObjectAt(theatreState, "particles", time);
      if (particleCloud) {
        const uniforms = particleCloud.material.uniforms;
        uniforms.uSize.value = particles.size ?? uniforms.uSize.value;
        uniforms.uSizeVariation.value =
          particles.sizeVariation ?? uniforms.uSizeVariation.value;
        uniforms.uOpacity.value =
          particles.opacity ?? uniforms.uOpacity.value;
        uniforms.uBlur.value = particles.blur ?? uniforms.uBlur.value;
        uniforms.uSpeed.value = particles.speed ?? uniforms.uSpeed.value;
        uniforms.uTurbulence.value =
          particles.turbulence ?? uniforms.uTurbulence.value;
        uniforms.uBlinkSpeed.value =
          particles["blink.speed"] ?? uniforms.uBlinkSpeed.value;
        uniforms.uBlinkMin.value =
          particles["blink.min"] ?? uniforms.uBlinkMin.value;
        if (particles["color.r"] !== undefined) {
          (uniforms.uColor.value as THREE.Color).setRGB(
            particles["color.r"],
            particles["color.g"] ?? particles["color.r"],
            particles["color.b"] ?? particles["color.r"]
          );
        }
        particleCloud.points.scale.set(
          particles["scale.x"] ?? particleCloud.points.scale.x,
          particles["scale.y"] ?? particleCloud.points.scale.y,
          particles["scale.z"] ?? particleCloud.points.scale.z
        );
        particleCloud.points.position.set(
          particles["position.x"] ?? particleCloud.points.position.x,
          particles["position.y"] ?? particleCloud.points.position.y,
          particles["position.z"] ?? particleCloud.points.position.z
        );
        const count = Math.min(
          1000,
          Math.max(0, Math.floor(particles.count ?? 100))
        );
        particleCloud.points.geometry.setDrawRange(0, count);
      }
    }

    orderedAssets.forEach((asset, index) => {
      const key = `asset-${index + 1}`;
      if (asset.kind === "texture") loadTexturePlane(asset.src, key);
      else if (asset.kind === "image") loadImagePlane(asset.src, key);
      else if (asset.kind === "video")
        loadVideoPlane(asset.src, asset.fallback, key);
      else loadModel(asset.src, key);
    });
    if (backgroundModel) loadModel(backgroundModel, undefined, true);

    let theatreState: TheatreProjectState | null = null;
    let seqLength = 10;
    let cameraGaze = 0.5;
    if (theatrePath) {
      fetch(theatrePath)
        .then((r) => r.json())
        .then((json: TheatreProjectState) => {
          if (disposed) return;
          theatreState = json;
          seqLength = getSequenceLength(json);
          const initialCamera = evalObjectAt(json, "camera", timelineStart);
          baseCam.x = initialCamera["position.x"] ?? baseCam.x;
          baseCam.y = initialCamera["position.y"] ?? baseCam.y;
          baseCam.z = initialCamera["position.z"] ?? baseCam.z;
          camera.fov = initialCamera.fov ?? camera.fov;
          cameraGaze = initialCamera.gaze ?? cameraGaze;
          baseRotation.x = initialCamera["rotation.x"] ?? baseRotation.x;
          baseRotation.y = initialCamera["rotation.y"] ?? baseRotation.y;
          baseRotation.z = initialCamera["rotation.z"] ?? baseRotation.z;
          camera.updateProjectionMatrix();
          camTarget.x = initialCamera["target.x"] ?? camTarget.x;
          camTarget.y = initialCamera["target.y"] ?? camTarget.y;
          camTarget.z = initialCamera["target.z"] ?? camTarget.z;
          for (const { key, object } of assetObjects) {
            applyAssetTransform(key, object, timelineStart);
          }
          createParticleCloud();
          applySceneEffects(timelineStart);
          camState.t = timelineStart;
          scrubAnimationsTo(timelineStart);
          scrollTrigger?.update();
          if (sceneId === "hero" && !reduce) {
            const intro = { position: 0 };
            heroIntroTween = gsap.to(intro, {
              position: 1,
              duration: 5,
              delay: 0.1,
              ease: "power3.out",
              onUpdate: () => {
                heroIntroPosition = intro.position;
                applyTheatreTime(
                  heroIntroPosition + heroScrollOffset()
                );
              },
            });
          } else if (sceneId === "hero") {
            heroIntroPosition = 1;
            applyTheatreTime(1);
          }
        })
        .catch(() => {});
    }

    const camTarget = { x: null as number | null, y: 0, z: 0 };
    const orbitTarget = new THREE.Vector3();
    const orbitDirection = new THREE.Vector3();
    const orbitRight = new THREE.Vector3();
    const orbitUp = new THREE.Vector3(0, 1, 0);
    const renderClock = new THREE.Clock();
    const namedCameraPosition = new THREE.Vector3();
    const namedCameraQuaternion = new THREE.Quaternion();
    const namedCameraOffset = new THREE.Vector3();
    const namedCameraOrbit = new THREE.Quaternion();
    const namedCameraEuler = new THREE.Euler();

    function applyTheatreTime(time: number) {
      camState.t = THREE.MathUtils.clamp(time, 0, seqLength);
      container!.dataset.sceneTime = camState.t.toFixed(4);
      scrubAnimationsTo(camState.t);
      applySceneEffects(camState.t);
      if (!theatreState) return;
      for (const { key, object } of assetObjects) {
        applyAssetTransform(key, object, camState.t);
      }
      const cam = evalObjectAt(theatreState, "camera", camState.t);
      if (cam["position.x"] !== undefined) {
        baseCam.x = cam["position.x"] ?? baseCam.x;
        baseCam.y = cam["position.y"] ?? baseCam.y;
        baseCam.z = cam["position.z"] ?? baseCam.z;
      }
      if (cam.fov !== undefined) {
        camera.fov = cam.fov;
        camera.updateProjectionMatrix();
      }
      cameraGaze = cam.gaze ?? cameraGaze;
      baseRotation.x = cam["rotation.x"] ?? baseRotation.x;
      baseRotation.y = cam["rotation.y"] ?? baseRotation.y;
      baseRotation.z = cam["rotation.z"] ?? baseRotation.z;
      if (cam["target.x"] !== undefined) {
        camTarget.x = cam["target.x"] ?? 0;
        camTarget.y = cam["target.y"] ?? 0;
        camTarget.z = cam["target.z"] ?? 0;
      }
      container!.dataset.cameraState = [
        baseCam.x,
        baseCam.y,
        baseCam.z,
        camera.fov,
        camTarget.x ?? 0,
        camTarget.y,
        camTarget.z,
      ]
        .map((value) => value.toFixed(4))
        .join(",");
      for (const { key, light } of pointLights) {
        const values = evalObjectAt(theatreState, key, camState.t);
        light.position.set(
          values["position.x"] ?? light.position.x,
          values["position.y"] ?? light.position.y,
          values["position.z"] ?? light.position.z
        );
        light.intensity = values.intensity ?? light.intensity;
        light.distance = values.distance ?? light.distance;
        if (values["color.r"] !== undefined) {
          light.color.setRGB(
            values["color.r"],
            values["color.g"] ?? values["color.r"],
            values["color.b"] ?? values["color.r"]
          );
        }
      }
      const environmentValues = evalObjectAt(
        theatreState,
        "environment",
        camState.t
      );
      scene.environmentIntensity =
        environmentValues.envIntensity ?? scene.environmentIntensity;
      scene.environmentRotation.set(
        environmentValues["envRotation.x"] ?? scene.environmentRotation.x,
        environmentValues["envRotation.y"] ?? scene.environmentRotation.y,
        environmentValues["envRotation.z"] ?? scene.environmentRotation.z
      );
      if ((environmentValues.display ?? 0) >= 0.5 && scene.environment) {
        scene.background = scene.environment;
        scene.backgroundIntensity = scene.environmentIntensity;
        scene.backgroundRotation.copy(scene.environmentRotation);
      } else {
        scene.background = null;
      }
    }

    let raf: number;
    function tick() {
      const delta = Math.min(renderClock.getDelta(), 0.05);
      pointerOffset.x += (pointerTarget.x - pointerOffset.x) * 0.1;
      pointerOffset.y += (pointerTarget.y - pointerOffset.y) * 0.1;
      for (const { mixer } of animGroups) mixer.update(delta);
      if (particleCloud) {
        particleCloud.material.uniforms.uTime.value =
          renderClock.elapsedTime;
      }
      if (customCameraNode) {
        customCameraNode.updateWorldMatrix(true, false);
        customCameraNode.getWorldPosition(namedCameraPosition);
        customCameraNode.getWorldQuaternion(namedCameraQuaternion);
        camera.position.copy(namedCameraPosition);
        camera.quaternion.copy(namedCameraQuaternion);
        const pan = pointerOffset.x * 0.1 * cameraGaze;
        const tilt = pointerOffset.y * 0.1 * cameraGaze;
        namedCameraOffset
          .set(pan, tilt, 0)
          .applyQuaternion(camera.quaternion);
        camera.position.add(namedCameraOffset);
        namedCameraEuler.set(
          -tilt + baseRotation.x,
          pan + baseRotation.y,
          baseRotation.z
        );
        namedCameraOrbit.setFromEuler(namedCameraEuler);
        camera.quaternion.multiply(namedCameraOrbit);
      } else {
        camera.position.set(baseCam.x, baseCam.y, baseCam.z);
      }
      if (!customCameraNode && camTarget.x !== null) {
        // Match the source Camera component: orbit the camera-to-target
        // direction by the smoothed pointer pan/tilt rather than translating
        // the camera in screen space.
        orbitTarget.set(camTarget.x, camTarget.y, camTarget.z);
        const distance = camera.position.distanceTo(orbitTarget);
        orbitDirection.copy(camera.position).sub(orbitTarget).normalize();
        const pan = pointerOffset.x * 0.1 * cameraGaze;
        const tilt = pointerOffset.y * 0.1 * cameraGaze;
        orbitDirection.applyAxisAngle(orbitUp, pan);
        orbitRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        orbitDirection.applyAxisAngle(orbitRight, tilt);
        camera.position.copy(
          orbitDirection.multiplyScalar(distance).add(orbitTarget)
        );
        camera.lookAt(orbitTarget);
        camera.rotateX(baseRotation.x);
        camera.rotateY(baseRotation.y);
        camera.rotateZ(baseRotation.z);
      }
      if (composer) composer.render(delta);
      else renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick();

    if (!reduce) {
      const triggerElement =
        (scrollTarget &&
          document.querySelector<HTMLElement>(scrollTarget)) ||
        container;
      if (sceneId !== "hero") {
        const applyTransitionVisibility = (progress: number) => {
          const p = THREE.MathUtils.clamp(progress, 0, 1);
          const smooth = p * p * (3 - 2 * p);
          container.style.opacity = String(smooth);
        };

        // Portal scenes are siblings, so a later scene must never flash above
        // the current one while ScrollTrigger is being constructed. Seed the
        // crossfade from layout immediately, then let ScrollTrigger scrub it.
        const triggerTop = triggerElement.getBoundingClientRect().top;
        const crossfadeOffset = window.innerHeight * earlyCrossfade;
        const initialVisibility = THREE.MathUtils.clamp(
          1 -
            (triggerTop - crossfadeOffset) /
              Math.max(1, window.innerHeight),
          0,
          1
        );
        applyTransitionVisibility(initialVisibility);
        visibilityTrigger = ScrollTrigger.create({
          trigger: triggerElement,
          start: `top ${100 + earlyCrossfade * 100}%`,
          end: `top ${earlyCrossfade * 100}%`,
          scrub: true,
          onUpdate: (self) => {
            applyTransitionVisibility(self.progress);
          },
        });
      } else {
        container.style.opacity = "1";
      }
      scrollTrigger = ScrollTrigger.create({
        trigger: triggerElement,
        // The captured hero placeholder is translated upward by its full
        // 150svh height, so geometry-based "top top" / "bottom top" marks it
        // complete at scrollY=0. Production instead advances this sheet in
        // viewport units: settled intro t=1, then +1 Theatre unit per 100vh.
        start:
          sceneId === "hero"
            ? 0
            : `top ${100 + earlyCrossfade * 100}%`,
        end:
          sceneId === "hero"
            ? () => triggerElement.offsetHeight
            : "bottom top",
        scrub: true,
        onUpdate: (self) => {
          const position =
            sceneId === "hero"
              ? heroIntroPosition + heroScrollOffset()
              : timelineStart +
                self.progress * (seqLength - timelineStart);
          applyTheatreTime(position);
        },
      });
    }

    function onResize() {
      const w = container!.offsetWidth;
      const h = container!.offsetHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer?.setSize(w, h);
      for (const { key, object } of assetObjects) {
        applyAssetTransform(key, object, camState.t);
      }
    }
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      scrollTrigger?.kill();
      visibilityTrigger?.kill();
      heroIntroTween?.kill();
      const disposedTextures = disposeObjectResources(scene);
      if (
        environmentTexture &&
        !disposedTextures.has(environmentTexture)
      ) {
        environmentTexture.dispose();
      }
      composer?.dispose();
      for (const video of ownedVideos) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      for (const frame of imageAnimationFrames) cancelAnimationFrame(frame);
      for (const img of ownedImages) {
        img.src = "";
      }
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost
      );
      renderer.renderLists.dispose();
      renderer.dispose();
      // `dispose()` releases Three.js resources but leaves the underlying
      // browser context alive. With one renderer per chapter (and React's
      // development effect replay), those contexts accumulate until Chrome
      // starts returning black canvases around Retail/Marketing.
      renderer.forceContextLoss();
    };
    // extraModels is intentionally omitted: callers pass array literals inline,
    // and re-running this whole effect on every render (destroying/recreating
    // the WebGL context) would be far worse than reading a possibly-stale
    // closure value, which is fine since it's only read once at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    sceneId,
    assets,
    model,
    backgroundModel,
    theatrePath,
    background,
    environmentPath,
    namedCamera,
    timelineStart,
    earlyCrossfade,
    scrollTarget,
    renderEpoch,
  ]);

  if (!portalHost) return null;

  return createPortal(
    <div
      ref={containerRef}
      data-scene-id={sceneId}
      style={{ opacity: sceneId === "hero" ? 1 : 0 }}
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    >
      <div
        ref={darkenRef}
        className="pointer-events-none absolute inset-0 z-10 bg-black opacity-0"
      />
    </div>,
    portalHost
  );
}
