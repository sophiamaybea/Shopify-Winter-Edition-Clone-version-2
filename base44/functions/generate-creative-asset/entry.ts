import { createClientFromRequest } from "npm:@base44/sdk";
import {
  DesignError,
  LIMITS,
  audit,
  bodyJson,
  fail,
  ok,
  requireAdmin,
} from "../../shared/design.ts";

const KINDS = new Set(["image", "video", "gif", "audio", "rive", "svg", "model3d", "shader", "texture", "other"]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireAdmin(base44);
    const input = await bodyJson(req);
    const kind = typeof input?.kind === "string" ? input.kind : "image";
    if (!KINDS.has(kind)) throw new DesignError("INVALID_REQUEST", "Unsupported creative asset kind.");
    const conversationId = typeof input?.conversation_id === "string" ? input.conversation_id : "";
    if (!conversationId) throw new DesignError("INVALID_REQUEST", "conversation_id is required.");

    const existing = await base44.asServiceRole.entities.CreativeAsset.filter(
      { owner_user_id: user.id, conversation_id: conversationId },
      "-created_date",
      LIMITS.maxAssets + 1,
      0,
    );
    if (existing.length >= LIMITS.maxAssets) {
      throw new DesignError("PAYLOAD_TOO_LARGE", `A conversation may stage at most ${LIMITS.maxAssets} creative assets.`);
    }

    let url = typeof input?.source_url === "string" ? input.source_url.trim() : "";
    const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new DesignError("ASSET_NOT_ALLOWED", "Asset URL is invalid."); }
      if (parsed.protocol !== "https:") throw new DesignError("ASSET_NOT_ALLOWED", "Only HTTPS asset URLs are accepted.");
      const host = parsed.hostname.toLowerCase();
      if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "169.254.169.254"].includes(host)) {
        throw new DesignError("ASSET_NOT_ALLOWED", "Private/local asset URLs are not allowed.");
      }
    }

    if (!url && kind === "image") {
      if (!prompt) throw new DesignError("INVALID_REQUEST", "Image generation requires a prompt.");
      const result = await base44.integrations.Core.GenerateImage({ prompt });
      if (!result?.url) throw new DesignError("ASSET_GENERATION_FAILED", "Base44 did not return an image URL.", 502);
      url = result.url;
    } else if (!url && kind === "video") {
      if (!prompt) throw new DesignError("INVALID_REQUEST", "Video generation requires a prompt.");
      const generateVideo = (base44.integrations.Core as any)?.GenerateVideo;
      if (typeof generateVideo !== "function") {
        throw new DesignError(
          "VIDEO_GENERATION_UNAVAILABLE",
          "Video generation is not exposed by the installed Base44 SDK.",
          501,
        );
      }
      const result = await generateVideo({ prompt });
      url = result?.url || result?.video_url || "";
      if (!url) throw new DesignError("VIDEO_GENERATION_UNAVAILABLE", "Video generation did not return a usable URL.", 501);
    } else if (!url) {
      throw new DesignError(
        "ASSET_GENERATION_UNAVAILABLE",
        `${kind} generation is not exposed by the installed Base44 SDK. Upload or reference an approved HTTPS asset instead.`,
        501,
      );
    }

    const asset = await base44.asServiceRole.entities.CreativeAsset.create({
      owner_user_id: user.id,
      conversation_id: conversationId,
      name: typeof input?.name === "string" && input.name.trim() ? input.name.trim().slice(0, 180) : `${kind} asset`,
      kind,
      url,
      mime_type: typeof input?.mime_type === "string" ? input.mime_type : null,
      size: Number.isFinite(input?.size) ? Number(input.size) : null,
      width: Number.isFinite(input?.width) ? Number(input.width) : null,
      height: Number.isFinite(input?.height) ? Number(input.height) : null,
      duration: Number.isFinite(input?.duration) ? Number(input.duration) : null,
      prompt: prompt || null,
      status: "staged",
      metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : {},
      interaction_config: input?.interaction_config && typeof input.interaction_config === "object" ? input.interaction_config : {},
      repo_path: null,
      failure_code: null,
    });

    await audit(base44, {
      user_id: user.id,
      conversation_id: conversationId,
      event: "asset_generated",
      metadata: { asset_id: asset.id, kind, generated: !input?.source_url },
    });

    return ok({
      asset: {
        id: asset.id,
        conversation_id: asset.conversation_id,
        name: asset.name,
        kind: asset.kind,
        url: asset.url,
        mime_type: asset.mime_type,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        prompt: asset.prompt,
        status: asset.status,
        metadata: asset.metadata,
        interaction_config: asset.interaction_config,
        repo_path: asset.repo_path,
        created_date: asset.created_date,
      },
    }, 201);
  } catch (error) {
    return fail(error);
  }
});
