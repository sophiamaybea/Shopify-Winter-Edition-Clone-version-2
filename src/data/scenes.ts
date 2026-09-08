export type SceneAsset =
  | { kind: "model"; src: string }
  | { kind: "texture"; src: string }
  | { kind: "video"; src: string; fallback: string }
  | { kind: "image"; src: string };

export interface SceneDefinition {
  assets: SceneAsset[];
  theatre: string;
  environment: string;
  customCameraName?: string;
  sequenceStart?: number;
  earlyCrossfade?: number;
}

const model = (src: string): SceneAsset => ({ kind: "model", src });
const texture = (src: string): SceneAsset => ({ kind: "texture", src });
const image = (src: string): SceneAsset => ({ kind: "image", src });
const video = (src: string, fallback: string): SceneAsset => ({
  kind: "video",
  src,
  fallback,
});

const environment = "/assets/3d/textures/studio_small_09_1k.pmrem.ktx2";

/**
 * The order here is the source page's `backgroundAssets` order. Every entry,
 * including a KTX2 plane, consumes an `asset-N` Theatre slot.
 */
export const scenes = {
  hero: {
    assets: [
      image("/assets/hero-replacement.gif"),
      texture("/assets/3d/textures/Hero-bg-hires-optimized.ktx2"),
    ],
    theatre: "/assets/3d/theatre/HeroScene.theatre-project-state_15.json",
    environment,
    sequenceStart: 0,
  },
  sidekick: {
    assets: [
      model("/assets/3d/models/EW26_Sidekick_251208_compressed-optimized.glb"),
      texture(
        "/assets/3d/textures/EW26_Sidekick_bg_stars-optimized_89d84022-03c9-4267-bb0f-71a26f688511.ktx2"
      ),
    ],
    theatre:
      "/assets/3d/theatre/SidekickScene.theatre-project-state_14_910d17ff-f5fb-4da0-920e-1b66f8d229b3.json",
    environment,
  },
  agentic: {
    assets: [
      model("/assets/3d/models/Agentic_fg_251209_compressed-optimized.glb"),
      texture("/assets/3d/textures/Agentic_Bg_windowscene-optimized.ktx2"),
      model("/assets/3d/models/Rigged_Book_CS_Animated_V5_compressed-optimized.glb"),
      model("/assets/3d/models/EW26_Agentic_Props_251209v5_compressed-optimized.glb"),
    ],
    theatre: "/assets/3d/theatre/AgenticScene.theatre-project-state.json",
    environment,
  },
  online: {
    assets: [
      model("/assets/3d/models/EW26_Online_251209v3_compressed-optimized.glb"),
      texture(
        "/assets/3d/textures/Online_bg-brighter_251201v2-optimized_5cdbdf82-dff0-40c9-8c76-111f92afc5ee.ktx2"
      ),
      video(
        "/assets/3d/video/online.webm",
        "/assets/3d/textures/code2.ktx2"
      ),
    ],
    theatre:
      "/assets/3d/theatre/OnlineScene.theatre-project-state_1_5a646934-a79e-49ac-80a9-825d8a3fb221.json",
    environment,
    earlyCrossfade: 0.2,
  },
  retail: {
    assets: [
      model("/assets/3d/models/POS_V53_environment_251209v2_compressed-optimized.glb"),
      model("/assets/3d/models/POS_v53_Hub_251208v2_compressed-optimized.glb"),
      model("/assets/3d/models/Retail_mg_251205v2_compressed-optimized.glb"),
      video(
        "/assets/3d/video/retail.webm",
        "/assets/3d/textures/DomeTexture.ktx2"
      ),
    ],
    theatre:
      "/assets/3d/theatre/RetailScene.theatre-project-state-cs-251209v2_b28f3c6c-7ab6-4036-9ac4-9f48df3024f0.json",
    environment,
    customCameraName: "posxxlcamera",
    earlyCrossfade: 0.2,
  },
  marketing: {
    assets: [
      model("/assets/3d/models/EW26_Marketing_251209v4_compressed-optimized.glb"),
      texture("/assets/3d/textures/Marketing_bg_retouched_v3-optimized.ktx2"),
      video(
        "/assets/3d/video/marketing.webm",
        "/assets/3d/textures/skate.ktx2"
      ),
    ],
    theatre: "/assets/3d/theatre/MarketingScene.theatre-project-state_12.json",
    environment,
    earlyCrossfade: 0.2,
  },
  checkout: {
    assets: [
      model("/assets/3d/models/EW26_Checkout_251209_compressed-optimized.glb"),
      texture("/assets/3d/textures/Checkout_bg_diffuse-optimized.ktx2"),
    ],
    theatre: "/assets/3d/theatre/CheckoutScene.theatre-project-state_13.json",
    environment,
    earlyCrossfade: 0.2,
  },
  operations: {
    assets: [
      model("/assets/3d/models/EW26_Operations_251207_compressed-optimized.glb"),
      texture("/assets/3d/textures/Operations_bg_diffuse-optimized.ktx2"),
      model("/assets/3d/models/Renaissance_Globe_251209v2-optimized.glb"),
    ],
    theatre: "/assets/3d/theatre/OperationsScene.theatre-project-state_8.json",
    environment,
    earlyCrossfade: 0.2,
  },
  "shop-app": {
    assets: [
      model("/assets/3d/models/EW26_ShopApp_251208v3_compressed-optimized.glb"),
      texture("/assets/3d/textures/ShopApp_bg_diffuse-optimized.ktx2"),
    ],
    theatre: "/assets/3d/theatre/ShopAppScene.theatre-project-state_8.json",
    environment,
    earlyCrossfade: 0.2,
  },
  b2b: {
    assets: [
      model("/assets/3d/models/EW26_B2B_251205v2_compressed-optimized.glb"),
      texture("/assets/3d/textures/B2B_Bg_Dark_251202-optimized.ktx2"),
    ],
    theatre: "/assets/3d/theatre/B2BScene.theatre-project-state_4.json",
    environment,
    earlyCrossfade: 0.2,
  },
  finance: {
    assets: [
      model("/assets/3d/models/EW26_Finance_251208v2_compressed-optimized.glb"),
      texture("/assets/3d/textures/Finance_bg-optimized.ktx2"),
    ],
    theatre: "/assets/3d/theatre/FinanceScene.theatre-project-state_7.json",
    environment,
    earlyCrossfade: 0.2,
  },
  shipping: {
    assets: [
      model("/assets/3d/models/EW26_Shipping_251204_compressed-optimized.glb"),
      texture("/assets/3d/textures/Shipping_bg_diffuse-optimized.ktx2"),
      model("/assets/3d/models/key.glb"),
    ],
    theatre: "/assets/3d/theatre/ShippingScene.theatre-project-state_12.json",
    environment,
    earlyCrossfade: 0.2,
  },
  developer: {
    assets: [
      model("/assets/3d/models/EW26_Developer_251207v5_compressed-optimized.glb"),
      texture("/assets/3d/textures/Developer_bg_diffuse-optimized.ktx2"),
    ],
    theatre: "/assets/3d/theatre/DeveloperScene.theatre-project-state_5.json",
    environment,
    earlyCrossfade: 0.2,
  },
} satisfies Record<string, SceneDefinition>;

export type SceneId = keyof typeof scenes;
