import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import {
  evalObjectAt,
  getSequenceLength,
  getStaticObjectValues,
  getStaticStringValue,
  hasAnimatedTrack,
  type TheatreProjectState,
} from "@/lib/theatreTrack";
import {
  type SceneAsset,
  type SceneDefinition,
  type SceneId,
} from "@/data/scenes";

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

// Decoders are served from public/assets/3d/decoders so the build stays fully
// local and offline-reproducible; a CDN path also breaks the asset-parity gate.
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

export function loadSharedEnvironment(
  renderer: THREE.WebGLRenderer,
  path: string
): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    getKtx2Loader(renderer).load(
      path,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        resolve(texture);
      },
      undefined,
      () => resolve(null)
    );
  });
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
  protectedTextures: ReadonlySet<THREE.Texture> = new Set()
) {
  const disposedTextures = new Set(protectedTextures);
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      if (!disposedGeometries.has(object.geometry)) {
        disposedGeometries.add(object.geometry);
        object.geometry.dispose();
      }
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
}

interface AnimationGroup {
  key: string;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
}

interface VideoGroup {
  key: string;
  video: HTMLVideoElement;
}

interface AssetObject {
  key: string;
  object: THREE.Group;
}

interface ParticleCloud {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

export interface ScenePointer {
  x: number;
  y: number;
}

export interface SceneEffectState {
  bloomIntensity: number;
  bloomEnabled: boolean;
  bloomThreshold: number;
  bloomRadius: number;
  darkenIntensity: number;
  overlayPosition: number;
  overlayColor: THREE.Color;
  fadeCenterPoint: THREE.Vector3;
}

interface SceneRuntimeOptions {
  id: SceneId;
  definition: SceneDefinition;
  renderer: THREE.WebGLRenderer;
  environment: Promise<THREE.Texture | null>;
  width: number;
  height: number;
  reducedMotion: boolean;
}

/**
 * A detached chapter scene. It owns no canvas or WebGL context; all GPU
 * uploads and rendering flow through the compositor's single renderer.
 */
export class SceneRuntime {
  readonly id: SceneId;
  readonly definition: SceneDefinition;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly effects: SceneEffectState = {
    bloomIntensity: 0,
    bloomEnabled: false,
    bloomThreshold: 0.9,
    bloomRadius: 0.85,
    darkenIntensity: 0,
    overlayPosition: -1,
    overlayColor: new THREE.Color(0.9, 0.9, 0.9),
    fadeCenterPoint: new THREE.Vector3(),
  };

  ready = false;
  status: "loading" | "ready" | "asset-error" | "disposed" = "loading";

  private readonly renderer: THREE.WebGLRenderer;
  private readonly reducedMotion: boolean;
  private readonly ktx2Loader: KTX2Loader;
  private readonly gltfLoader: GLTFLoader;
  private readonly assetObjects: AssetObject[] = [];
  private readonly animationGroups: AnimationGroup[] = [];
  private readonly videoGroups: VideoGroup[] = [];
  private readonly ownedVideos = new Set<HTMLVideoElement>();
  private readonly ownedImages = new Set<HTMLImageElement>();
  private imageAnimationFrames: number[] = [];
  private readonly pointLights: Array<{
    key: string;
    light: THREE.PointLight;
  }>;
  private readonly safetyLights: THREE.Light[];
  private readonly baseCamera = { x: 0, y: 0, z: 4 };
  private readonly baseRotation = { x: 0, y: 0, z: 0 };
  private readonly cameraTarget = {
    x: null as number | null,
    y: 0,
    z: 0,
  };
  private readonly orbitTarget = new THREE.Vector3();
  private readonly orbitDirection = new THREE.Vector3();
  private readonly orbitRight = new THREE.Vector3();
  private readonly orbitUp = new THREE.Vector3(0, 1, 0);
  private readonly namedCameraPosition = new THREE.Vector3();
  private readonly namedCameraQuaternion = new THREE.Quaternion();
  private readonly namedCameraOffset = new THREE.Vector3();
  private readonly namedCameraOrbit = new THREE.Quaternion();
  private readonly namedCameraEuler = new THREE.Euler();
  private readonly protectedTextures = new Set<THREE.Texture>();

  private theatreState: TheatreProjectState | null = null;
  private sequenceLength = 10;
  private cameraGaze = 0.5;
  private currentTime = 0;
  private customCameraNode: THREE.Object3D | null = null;
  private particleCloud: ParticleCloud | null = null;
  private sharedEnvironment: THREE.Texture | null = null;
  private loadedAssets = 0;
  private theatreLoaded = false;
  private disposed = false;
  private heroIntroStartedAt = 0;

  constructor(options: SceneRuntimeOptions) {
    this.id = options.id;
    this.definition = options.definition;
    this.renderer = options.renderer;
    this.reducedMotion = options.reducedMotion;
    this.camera = new THREE.PerspectiveCamera(
      30,
      options.width / Math.max(1, options.height),
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 4);
    this.camera.name = `${this.id}-camera`;
    this.scene.add(this.camera);

    this.pointLights = [
      {
        key: "light-1",
        light: new THREE.PointLight(
          0xff0000,
          this.id === "hero" ? 1 : 0,
          10
        ),
      },
      {
        key: "light-2",
        light: new THREE.PointLight(
          0x0000ff,
          this.id === "hero" ? 1 : 0,
          10
        ),
      },
    ];
    this.pointLights[0].light.position.set(-0.5, 0, 0.5);
    this.pointLights[1].light.position.set(0.5, 0, 0.5);
    for (const { light } of this.pointLights) this.scene.add(light);

    // Kept from RealScene, but strictly as a fallback: it bridges the visual
    // energy until the source PMREM decodes, and stays only if that decode
    // fails. The source lights these chapters from the environment alone, so
    // leaving the rig on once the PMREM is bound double-lights every model.
    const safetyAmbient = new THREE.AmbientLight(0xffffff, 0.6);
    const safetyKey = new THREE.DirectionalLight(0xffffff, 1.2);
    safetyKey.position.set(2, 3, 4);
    this.safetyLights = [safetyAmbient, safetyKey];
    this.scene.add(safetyAmbient, safetyKey);

    this.ktx2Loader = getKtx2Loader(options.renderer);
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);
    this.gltfLoader.setKTX2Loader(this.ktx2Loader);

    // Add stable placeholder groups before any request starts. The groups keep
    // scene graph/render order identical to backgroundAssets even when later
    // assets decode sooner than earlier ones.
    options.definition.assets.forEach((asset, index) => {
      const object = new THREE.Group();
      object.name = `${this.id}-asset-${index + 1}`;
      this.scene.add(object);
      this.assetObjects.push({ key: `asset-${index + 1}`, object });
      this.loadAsset(asset, object, `asset-${index + 1}`);
    });

    void options.environment.then((texture) => {
      if (this.disposed || !texture) return;
      this.sharedEnvironment = texture;
      this.protectedTextures.add(texture);
      this.scene.environment = texture;
      for (const light of this.safetyLights) this.scene.remove(light);
      this.safetyLights.length = 0;
      this.applyTheatreTime(this.currentTime);
    });

    void this.loadTheatreState();
  }

  setSize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    for (const { key, object } of this.assetObjects) {
      this.applyAssetTransform(key, object, this.currentTime);
    }
  }

  /**
   * `sequencePosition` is an absolute Theatre position in sequence units, not a
   * 0..1 fraction of the sequence — the source advances it one unit per
   * viewport scrolled. Tracks hold their last keyframe past the end, so it is
   * deliberately not clamped to `sequenceLength`.
   */
  update(
    sequencePosition: number,
    delta: number,
    elapsed: number,
    pointer: ScenePointer,
    nowMilliseconds: number,
    heroScrollTime?: number
  ) {
    if (this.disposed) return;
    const position = Math.max(0, sequencePosition);

    const timelineStart = this.definition.sequenceStart ?? 0;
    let time = timelineStart + position;
    if (this.id === "hero") {
      const intro = this.reducedMotion
        ? 1
        : this.heroIntroProgress(nowMilliseconds);
      time = intro + (heroScrollTime ?? position);
    }
    this.applyTheatreTime(time);

    for (const { mixer } of this.animationGroups) mixer.update(delta);
    if (this.particleCloud) {
      this.particleCloud.material.uniforms.uTime.value = elapsed;
    }
    this.applyCameraPointer(pointer);
    this.scene.updateMatrixWorld(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.status = "disposed";
    for (const { mixer } of this.animationGroups) {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
    }
    for (const video of this.ownedVideos) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    for (const frame of this.imageAnimationFrames)
      cancelAnimationFrame(frame);
    this.imageAnimationFrames = [];
    for (const img of this.ownedImages) {
      img.src = "";
    }
    this.ownedImages.clear();
    disposeObjectResources(this.scene, this.protectedTextures);
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.clear();
  }

  private heroIntroProgress(nowMilliseconds: number) {
    if (!this.theatreLoaded) return 0;
    const elapsed = nowMilliseconds - this.heroIntroStartedAt - 100;
    const normalized = THREE.MathUtils.clamp(elapsed / 5000, 0, 1);
    return 1 - (1 - normalized) ** 3;
  }

  private async loadTheatreState() {
    try {
      const response = await fetch(this.definition.theatre);
      if (!response.ok) throw new Error(`Theatre ${response.status}`);
      const state = (await response.json()) as TheatreProjectState;
      if (this.disposed) return;
      this.theatreState = state;
      this.sequenceLength = getSequenceLength(state);
      this.theatreLoaded = true;
      this.heroIntroStartedAt = performance.now();
      this.applyTheatreTime(this.definition.sequenceStart ?? 0);
      this.createParticleCloud();
      this.updateReadyState();
    } catch {
      if (this.disposed) return;
      this.status = "asset-error";
      // Keep a functional scene with the default camera if a state request
      // fails; this also avoids console.error noise in full-scroll validation.
      this.theatreLoaded = true;
      this.updateReadyState();
    }
  }

  private loadAsset(
    asset: SceneAsset,
    destination: THREE.Group,
    assetKey: string
  ) {
    if (asset.kind === "model") {
      this.gltfLoader.load(
        asset.src,
        (gltf) => {
          if (this.disposed) {
            disposeObjectResources(gltf.scene);
            return;
          }
          destination.add(gltf.scene);
          const namedCamera = this.definition.customCameraName;
          if (namedCamera && !this.customCameraNode) {
            this.customCameraNode =
              gltf.scene.getObjectByName(namedCamera) ?? null;
          }
          if (gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(gltf.scene);
            const actions = gltf.animations.map((clip) => {
              const action = mixer.clipAction(clip);
              action.play();
              return action;
            });
            mixer.update(0);
            this.animationGroups.push({ key: assetKey, mixer, actions });
          }
          this.applyAssetTransform(assetKey, destination, this.currentTime);
          this.scrubAnimationsTo(this.currentTime);
          this.markAssetLoaded();
        },
        undefined,
        () => this.markAssetError()
      );
      return;
    }

    if (asset.kind === "texture") {
      this.loadTextureInto(asset.src, destination, assetKey);
      return;
    }

    if (asset.kind === "image") {
      this.loadImageInto(asset.src, destination, assetKey);
      return;
    }

    this.loadVideoInto(asset.src, asset.fallback, destination, assetKey, asset.loop);
  }

  private loadTextureInto(
    path: string,
    destination: THREE.Group,
    assetKey: string,
    onComplete?: () => void
  ) {
    this.ktx2Loader.load(
      path,
      (texture) => {
        if (this.disposed) {
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
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          material
        );
        plane.scale.set(1, aspect, 1);
        destination.add(plane);
        this.applyAssetTransform(assetKey, destination, this.currentTime);
        if (onComplete) onComplete();
        else this.markAssetLoaded();
      },
      undefined,
      () => {
        if (onComplete) onComplete();
        else this.markAssetError();
      }
    );
  }

  private loadImageInto(
    path: string,
    destination: THREE.Group,
    assetKey: string
  ) {
    const PLANE_SCALE = 3.5;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = path;
    this.ownedImages.add(img);

    const onReady = () => {
      if (this.disposed) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 1024;
      canvas.height = img.naturalHeight || 1024;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        this.markAssetError();
        return;
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;

      const drawFrame = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        texture.needsUpdate = true;
      };
      drawFrame();

      const animate = () => {
        if (this.disposed) return;
        drawFrame();
        this.imageAnimationFrames.push(
          requestAnimationFrame(animate)
        );
      };
      this.imageAnimationFrames.push(
        requestAnimationFrame(animate)
      );

      const aspect =
        canvas.width > 0 ? canvas.height / canvas.width : 1;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      });
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(PLANE_SCALE, PLANE_SCALE),
        material
      );
      plane.scale.set(1, aspect, 1);
      destination.add(plane);
      this.applyAssetTransform(assetKey, destination, this.currentTime);
      this.markAssetLoaded();
    };

    if (img.complete && img.naturalWidth > 0) {
      onReady();
    } else {
      img.addEventListener("load", onReady, { once: true });
      img.addEventListener("error", () => this.markAssetError(), {
        once: true,
      });
    }
  }

  private loadVideoInto(
    path: string,
    fallbackPath: string,
    destination: THREE.Group,
    assetKey: string,
    loop = false
  ) {
    const video = document.createElement("video");
    video.src = path;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    if (loop) video.loop = true;
    this.ownedVideos.add(video);

    const onReady = () => {
      if (this.disposed) return;
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
      destination.add(plane);
      this.videoGroups.push({ key: assetKey, video });
      this.applyAssetTransform(assetKey, destination, this.currentTime);
      this.scrubAnimationsTo(this.currentTime);
      if (loop) video.play().catch(() => {});
      this.markAssetLoaded();
    };
    const onError = () => {
      if (this.disposed) return;
      this.loadTextureInto(fallbackPath, destination, assetKey, () => {
        if (destination.children.length > 0) this.markAssetLoaded();
        else this.markAssetError();
      });
    };
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.load();
  }

  private markAssetLoaded() {
    if (this.disposed) return;
    this.loadedAssets += 1;
    this.updateReadyState();
  }

  private markAssetError() {
    if (this.disposed) return;
    this.loadedAssets += 1;
    this.status = "asset-error";
    this.updateReadyState();
  }

  private updateReadyState() {
    if (
      this.theatreLoaded &&
      this.loadedAssets >= this.definition.assets.length
    ) {
      this.ready = true;
      if (this.status !== "asset-error") this.status = "ready";
    }
  }

  private theatreClipKey(clipName: string) {
    return clipName.replace(/[ .-]/g, "_");
  }

  private scrubAnimationsTo(time: number) {
    for (const { key: objectKey, mixer, actions } of this.animationGroups) {
      const values = this.theatreState
        ? evalObjectAt(this.theatreState, objectKey, time)
        : {};
      const staticValues = this.theatreState
        ? getStaticObjectValues(this.theatreState, objectKey)
        : {};
      for (const action of actions) {
        const duration = action.getClip().duration || 1;
        const clipName = action.getClip().name;
        const alias = this.theatreClipKey(clipName);
        const exactProgressPath = `animations.${clipName}.progress`;
        const aliasProgressPath = `animations.${alias}.progress`;
        const progressPath =
          this.theatreState &&
          hasAnimatedTrack(
            this.theatreState,
            objectKey,
            exactProgressPath
          )
            ? exactProgressPath
            : this.theatreState &&
                hasAnimatedTrack(
                  this.theatreState,
                  objectKey,
                  aliasProgressPath
                )
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

    for (const { key, video } of this.videoGroups) {
      if (!this.theatreState || !Number.isFinite(video.duration)) continue;
      const values = evalObjectAt(this.theatreState, key, time);
      const frame = values.frame;
      if (frame === undefined) continue;
      video.currentTime = THREE.MathUtils.clamp(
        frame / 30,
        0,
        Math.max(0, video.duration - 1 / 30)
      );
    }
  }

  private applyAssetTransform(
    key: string,
    object: THREE.Object3D,
    time: number
  ) {
    if (!this.theatreState) return;
    const values = evalObjectAt(this.theatreState, key, time);
    const responsive = getStaticStringValue(
      this.theatreState,
      key,
      "responsive"
    );
    const responsiveScale =
      responsive === "cover"
        ? Math.max(1, this.camera.aspect)
        : responsive === "contain"
          ? Math.min(1, this.camera.aspect)
          : 1;

    // Theatre serializes only the channels an author actually touched, so every
    // axis has to be applied independently. Gating a whole vector on its `.x`
    // channel silently dropped the backdrops that author only `z` (Finance) or
    // `z`/`y` (Operations): the plane stayed at the origin, in front of the
    // models, and hid the scene behind it.
    const position = values["position.x"];
    if (position !== undefined) object.position.x = position * responsiveScale;
    if (values["position.y"] !== undefined)
      object.position.y = values["position.y"] * responsiveScale;
    if (values["position.z"] !== undefined)
      object.position.z = values["position.z"];

    if (values["rotation.x"] !== undefined)
      object.rotation.x = values["rotation.x"];
    if (values["rotation.y"] !== undefined)
      object.rotation.y = values["rotation.y"];
    if (values["rotation.z"] !== undefined)
      object.rotation.z = values["rotation.z"];

    if (values["scale.x"] !== undefined)
      object.scale.x = values["scale.x"] * responsiveScale;
    if (values["scale.y"] !== undefined)
      object.scale.y = values["scale.y"] * responsiveScale;
    if (values["scale.z"] !== undefined)
      object.scale.z = values["scale.z"] * responsiveScale;
    if (values.visibility !== undefined) {
      const visibility = THREE.MathUtils.clamp(values.visibility, 0, 1);
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

  private createParticleCloud() {
    if (!this.theatreState || this.particleCloud) return;
    const values = getStaticObjectValues(this.theatreState, "particles");
    if ((values.enabled ?? 0) < 0.5) return;

    const capacity = 1000;
    const count = Math.min(
      capacity,
      Math.max(1, Math.round(values.count ?? 100))
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
    for (let index = 0; index < capacity; index += 1) {
      positions[index * 3] = (random() - 0.5) * 2;
      positions[index * 3 + 1] = (random() - 0.5) * 2;
      positions[index * 3 + 2] = (random() - 0.5) * 2;
      velocities[index * 3] = (random() - 0.5) * 2;
      velocities[index * 3 + 1] = (random() - 0.5) * 2;
      velocities[index * 3 + 2] = (random() - 0.5) * 2;
      phases[index] = random() * Math.PI * 2;
      sizeScales[index] = 0.5 + random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
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
    for (let offset = 0; offset < noiseData.length; offset += 4) {
      const value = Math.floor(random() * 256);
      noiseData[offset] = value;
      noiseData[offset + 1] = value;
      noiseData[offset + 2] = value;
      noiseData[offset + 3] = 255;
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

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: values.size ?? 0.1 },
        uSizeVariation: { value: values.sizeVariation ?? 0 },
        uColor: {
          value: new THREE.Color(
            values["color.r"] ?? 1,
            values["color.g"] ?? 1,
            values["color.b"] ?? 1
          ),
        },
        uOpacity: { value: values.opacity ?? 0.6 },
        uBlur: { value: values.blur ?? 0.5 },
        uTime: { value: 0 },
        uSpeed: { value: values.speed ?? 0.5 },
        uTurbulence: { value: values.turbulence ?? 0.2 },
        uBlinkSpeed: { value: values["blink.speed"] ?? 0 },
        uBlinkMin: { value: values["blink.min"] ?? 0.3 },
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
      values["scale.x"] ?? 10,
      values["scale.y"] ?? 10,
      values["scale.z"] ?? 10
    );
    points.position.set(
      values["position.x"] ?? 0,
      values["position.y"] ?? 0,
      values["position.z"] ?? -5
    );
    points.frustumCulled = false;
    this.scene.add(points);
    this.particleCloud = { points, material };
  }

  private applySceneEffects(time: number) {
    if (!this.theatreState) return;
    const effects = evalObjectAt(this.theatreState, "effects", time);
    const bloomEffect = evalObjectAt(
      this.theatreState,
      "bloom-effect",
      time
    );
    const intensity =
      effects["bloom.intensity"] ?? bloomEffect.intensity ?? 0;
    this.effects.bloomIntensity = Math.max(0, intensity);
    this.effects.bloomEnabled = intensity > 0.001;
    // No captured state authors these two, so the fallbacks are what actually
    // runs. They are BloomEffect's defaults, and they are meaningful only
    // because the compositor now thresholds the tone-mapped frame.
    this.effects.bloomThreshold =
      effects["bloom.luminanceThreshold"] ?? 0.9;
    this.effects.bloomRadius =
      effects["bloom.radius"] ?? (this.id === "hero" ? 0.85 : 0.25);
    this.effects.darkenIntensity = THREE.MathUtils.clamp(
      effects["darken.intensity"] ?? effects["darken.amount"] ?? 0,
      0,
      1
    );
    this.effects.overlayPosition = THREE.MathUtils.clamp(
      effects["overlay.position"] ?? -1,
      -1,
      1
    );
    if (effects["overlay.color.r"] !== undefined) {
      this.effects.overlayColor.setRGB(
        effects["overlay.color.r"],
        effects["overlay.color.g"] ?? effects["overlay.color.r"],
        effects["overlay.color.b"] ?? effects["overlay.color.r"]
      );
    }
    this.effects.fadeCenterPoint.set(
      effects["sectionTransition.fadeCenter.x"] ?? 0,
      effects["sectionTransition.fadeCenter.y"] ?? 0,
      effects["sectionTransition.fadeCenter.z"] ?? 0
    );

    const particles = evalObjectAt(this.theatreState, "particles", time);
    if (!this.particleCloud) return;
    const uniforms = this.particleCloud.material.uniforms;
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
    this.particleCloud.points.scale.set(
      particles["scale.x"] ?? this.particleCloud.points.scale.x,
      particles["scale.y"] ?? this.particleCloud.points.scale.y,
      particles["scale.z"] ?? this.particleCloud.points.scale.z
    );
    this.particleCloud.points.position.set(
      particles["position.x"] ?? this.particleCloud.points.position.x,
      particles["position.y"] ?? this.particleCloud.points.position.y,
      particles["position.z"] ?? this.particleCloud.points.position.z
    );
    this.particleCloud.points.geometry.setDrawRange(
      0,
      Math.min(
        1000,
        Math.max(0, Math.floor(particles.count ?? 100))
      )
    );
  }

  private applyTheatreTime(time: number) {
    this.currentTime = THREE.MathUtils.clamp(time, 0, this.sequenceLength);
    this.scrubAnimationsTo(this.currentTime);
    this.applySceneEffects(this.currentTime);
    if (!this.theatreState) return;

    for (const { key, object } of this.assetObjects) {
      this.applyAssetTransform(key, object, this.currentTime);
    }
    const camera = evalObjectAt(
      this.theatreState,
      "camera",
      this.currentTime
    );
    if (camera["position.x"] !== undefined) {
      this.baseCamera.x = camera["position.x"] ?? this.baseCamera.x;
      this.baseCamera.y = camera["position.y"] ?? this.baseCamera.y;
      this.baseCamera.z = camera["position.z"] ?? this.baseCamera.z;
    }
    if (camera.fov !== undefined) {
      this.camera.fov = camera.fov;
      this.camera.updateProjectionMatrix();
    }
    this.cameraGaze = camera.gaze ?? this.cameraGaze;
    this.baseRotation.x =
      camera["rotation.x"] ?? this.baseRotation.x;
    this.baseRotation.y =
      camera["rotation.y"] ?? this.baseRotation.y;
    this.baseRotation.z =
      camera["rotation.z"] ?? this.baseRotation.z;
    if (camera["target.x"] !== undefined) {
      this.cameraTarget.x = camera["target.x"] ?? 0;
      this.cameraTarget.y = camera["target.y"] ?? 0;
      this.cameraTarget.z = camera["target.z"] ?? 0;
    }

    for (const { key, light } of this.pointLights) {
      const values = evalObjectAt(this.theatreState, key, this.currentTime);
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

    const environment = evalObjectAt(
      this.theatreState,
      "environment",
      this.currentTime
    );
    this.scene.environmentIntensity =
      environment.envIntensity ?? this.scene.environmentIntensity;
    this.scene.environmentRotation.set(
      environment["envRotation.x"] ?? this.scene.environmentRotation.x,
      environment["envRotation.y"] ?? this.scene.environmentRotation.y,
      environment["envRotation.z"] ?? this.scene.environmentRotation.z
    );
    if ((environment.display ?? 0) >= 0.5 && this.scene.environment) {
      this.scene.background = this.scene.environment;
      this.scene.backgroundIntensity = this.scene.environmentIntensity;
      this.scene.backgroundRotation.copy(this.scene.environmentRotation);
    } else {
      this.scene.background = null;
    }
  }

  private applyCameraPointer(pointer: ScenePointer) {
    if (this.customCameraNode) {
      this.customCameraNode.updateWorldMatrix(true, false);
      this.customCameraNode.getWorldPosition(this.namedCameraPosition);
      this.customCameraNode.getWorldQuaternion(this.namedCameraQuaternion);
      this.camera.position.copy(this.namedCameraPosition);
      this.camera.quaternion.copy(this.namedCameraQuaternion);
      const pan = pointer.x * 0.1 * this.cameraGaze;
      const tilt = pointer.y * 0.1 * this.cameraGaze;
      this.namedCameraOffset
        .set(pan, tilt, 0)
        .applyQuaternion(this.camera.quaternion);
      this.camera.position.add(this.namedCameraOffset);
      this.namedCameraEuler.set(
        -tilt + this.baseRotation.x,
        pan + this.baseRotation.y,
        this.baseRotation.z
      );
      this.namedCameraOrbit.setFromEuler(this.namedCameraEuler);
      this.camera.quaternion.multiply(this.namedCameraOrbit);
      return;
    }

    this.camera.position.set(
      this.baseCamera.x,
      this.baseCamera.y,
      this.baseCamera.z
    );
    if (this.cameraTarget.x === null) return;

    this.orbitTarget.set(
      this.cameraTarget.x,
      this.cameraTarget.y,
      this.cameraTarget.z
    );
    const distance = this.camera.position.distanceTo(this.orbitTarget);
    this.orbitDirection
      .copy(this.camera.position)
      .sub(this.orbitTarget)
      .normalize();
    const pan = pointer.x * 0.1 * this.cameraGaze;
    const tilt = pointer.y * 0.1 * this.cameraGaze;
    this.orbitDirection.applyAxisAngle(this.orbitUp, pan);
    this.orbitRight
      .set(1, 0, 0)
      .applyQuaternion(this.camera.quaternion);
    this.orbitDirection.applyAxisAngle(this.orbitRight, tilt);
    this.camera.position.copy(
      this.orbitDirection
        .multiplyScalar(distance)
        .add(this.orbitTarget)
    );
    this.camera.lookAt(this.orbitTarget);
    this.camera.rotateX(this.baseRotation.x);
    this.camera.rotateY(this.baseRotation.y);
    this.camera.rotateZ(this.baseRotation.z);
  }
}
