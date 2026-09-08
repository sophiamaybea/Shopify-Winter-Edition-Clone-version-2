import { createClientFromRequest } from "npm:@base44/sdk";
import {
  DesignError,
  assertDraftOwner,
  audit,
  bodyJson,
  fail,
  LIMITS,
  ok,
  requireAdmin,
  sanitizeDraft,
  sha256,
  transition,
} from "../../shared/design.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireAdmin(base44);
    const input = await bodyJson(req);
    if (typeof input?.draft_id !== "string" || !input.draft_id) {
      throw new DesignError("INVALID_REQUEST", "draft_id is required.");
    }

    const draft = await base44.asServiceRole.entities.DesignDraft.get(input.draft_id);
    assertDraftOwner(draft, user);
    if (!['staged', 'previewed'].includes(draft.status)) {
      throw new DesignError("DRAFT_NOT_PREVIEWED", "This draft cannot enter preview from its current state.", 409);
    }

    const approvalToken = crypto.randomUUID();
    const tokenHash = await sha256(approvalToken);
    const expiresAt = new Date(Date.now() + LIMITS.approvalMinutes * 60_000).toISOString();
    const patch = {
      preview_revision: draft.revision,
      approval_token_hash: tokenHash,
      approval_token_expires_at: expiresAt,
      previewed_by: user.id,
      failure_code: null,
      failure_message: null,
    };
    const updated = draft.status === "staged"
      ? await transition(base44, draft, "previewed", patch)
      : await base44.asServiceRole.entities.DesignDraft.update(draft.id, patch);

    await audit(base44, {
      user_id: user.id,
      draft_id: draft.id,
      conversation_id: draft.conversation_id,
      event: "draft_previewed",
      base_commit: draft.base_commit_sha,
      file_count: draft.file_count || 0,
      metadata: { revision: draft.revision, expires_at: expiresAt },
    });

    return ok({
      draft: sanitizeDraft(updated),
      approval_token: approvalToken,
      approval_token_expires_at: expiresAt,
    });
  } catch (error) {
    return fail(error);
  }
});
