import { createClientFromRequest } from "npm:@base44/sdk";
import {
  DesignError,
  assertDraftOwner,
  audit,
  bodyJson,
  createAtomicCommit,
  fail,
  getGitHubToken,
  getHead,
  getRepoConfig,
  headRepresentsDraft,
  ok,
  requireAdmin,
  sanitizeDraft,
  sha256,
  transition,
} from "../../shared/design.ts";

function commitUrl(config: { owner: string; repo: string }, sha: string) {
  return `https://github.com/${config.owner}/${config.repo}/commit/${sha}`;
}

Deno.serve(async (req) => {
  let base44: any;
  let user: any;
  let draft: any;
  let transitionedToApplying = false;

  try {
    base44 = createClientFromRequest(req);
    user = await requireAdmin(base44);
    const input = await bodyJson(req);
    if (typeof input?.draft_id !== "string" || typeof input?.approval_token !== "string") {
      throw new DesignError("INVALID_REQUEST", "draft_id and approval_token are required.");
    }

    draft = await base44.asServiceRole.entities.DesignDraft.get(input.draft_id);
    assertDraftOwner(draft, user);

    if (draft.status === "applied" && draft.applied_commit_sha) {
      return ok({
        already_applied: true,
        commit_sha: draft.applied_commit_sha,
        commit_url: draft.applied_commit_url,
        draft: sanitizeDraft(draft),
      });
    }

    const config = getRepoConfig();
    const githubToken = await getGitHubToken(base44);
    const currentHead = await getHead(githubToken, config);

    if (draft.status === "applying") {
      const recovered = await headRepresentsDraft(githubToken, config, currentHead, draft.id);
      if (recovered) {
        const url = commitUrl(config, currentHead);
        const updated = await transition(base44, draft, "applied", {
          applied_commit_sha: currentHead,
          applied_commit_url: url,
          applied_by: user.id,
          approval_token_hash: null,
          approval_token_expires_at: null,
          failure_code: null,
          failure_message: null,
        });
        await audit(base44, {
          user_id: user.id,
          draft_id: draft.id,
          conversation_id: draft.conversation_id,
          event: "apply_succeeded",
          base_commit: draft.base_commit_sha,
          applied_commit: currentHead,
          file_count: draft.file_count || 0,
          metadata: { recovered: true },
        });
        return ok({ already_applied: true, commit_sha: currentHead, commit_url: url, draft: sanitizeDraft(updated) });
      }
      throw new DesignError("DRAFT_CURRENTLY_APPLYING", "This design draft is currently being applied.", 409);
    }

    if (draft.status !== "previewed") {
      throw new DesignError("DRAFT_NOT_PREVIEWED", "The design must be previewed before it can be applied.", 409);
    }
    if (Number(draft.preview_revision) !== Number(draft.revision)) {
      throw new DesignError("DRAFT_NOT_PREVIEWED", "The current revision has not been previewed.", 409);
    }
    if (!draft.approval_token_hash || !draft.approval_token_expires_at) {
      throw new DesignError("INVALID_APPROVAL_TOKEN", "A valid one-time approval token is required.", 403);
    }
    if (Date.parse(draft.approval_token_expires_at) <= Date.now()) {
      throw new DesignError("APPROVAL_EXPIRED", "The preview approval token has expired. Re-open the preview to continue.", 403);
    }
    const suppliedHash = await sha256(input.approval_token);
    if (suppliedHash !== draft.approval_token_hash) {
      throw new DesignError("INVALID_APPROVAL_TOKEN", "The approval token is invalid.", 403);
    }

    const existingAtHead = await headRepresentsDraft(githubToken, config, currentHead, draft.id);
    if (existingAtHead) {
      const url = commitUrl(config, currentHead);
      const updated = await base44.asServiceRole.entities.DesignDraft.update(draft.id, {
        status: "applied",
        applied_commit_sha: currentHead,
        applied_commit_url: url,
        applied_by: user.id,
        approval_token_hash: null,
        approval_token_expires_at: null,
        failure_code: null,
        failure_message: null,
      });
      return ok({ already_applied: true, commit_sha: currentHead, commit_url: url, draft: sanitizeDraft(updated) });
    }

    if (currentHead !== draft.base_commit_sha) {
      await audit(base44, {
        user_id: user.id,
        draft_id: draft.id,
        conversation_id: draft.conversation_id,
        event: "stale_draft_detected",
        base_commit: draft.base_commit_sha,
        applied_commit: currentHead,
        file_count: draft.file_count || 0,
      });
      throw new DesignError(
        "STALE_DRAFT",
        "The app changed after this design preview was created.",
        409,
        { expected_head: draft.base_commit_sha, actual_head: currentHead },
      );
    }

    draft = await transition(base44, draft, "applying", {
      approval_token_hash: null,
      approval_token_expires_at: null,
      failure_code: null,
      failure_message: null,
    });
    transitionedToApplying = true;
    await audit(base44, {
      user_id: user.id,
      draft_id: draft.id,
      conversation_id: draft.conversation_id,
      event: "apply_requested",
      base_commit: draft.base_commit_sha,
      file_count: draft.file_count || 0,
    });

    const title = String(draft.commit_message || draft.title || "Creative Director update")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 72);
    const marker = draft.revert_of_draft_id
      ? `DesignDraft: ${draft.id}\nReverts DesignDraft: ${draft.revert_of_draft_id}`
      : `DesignDraft: ${draft.id}`;
    const message = `design: ${title}\n\n${marker}`;

    const commit = await createAtomicCommit(githubToken, config, draft.base_commit_sha, draft.edits || [], message);
    const verifiedHead = await getHead(githubToken, config);
    if (verifiedHead !== commit.sha) {
      throw new DesignError("GITHUB_WRITE_FAILED", "GitHub main did not advance to the approved commit.", 502);
    }

    const url = commitUrl(config, commit.sha);
    const updated = await transition(base44, draft, "applied", {
      applied_commit_sha: commit.sha,
      applied_commit_url: url,
      applied_by: user.id,
      failure_code: null,
      failure_message: null,
    });
    await audit(base44, {
      user_id: user.id,
      draft_id: draft.id,
      conversation_id: draft.conversation_id,
      event: "apply_succeeded",
      base_commit: draft.base_commit_sha,
      applied_commit: commit.sha,
      file_count: draft.file_count || 0,
    });

    return ok({
      already_applied: false,
      commit_sha: commit.sha,
      commit_url: url,
      sync_status: "committed",
      sync_message: "Committed to GitHub main. Base44 source sync should import the commit through the existing GitHub integration; publishing may still be a separate Base44 action.",
      draft: sanitizeDraft(updated),
    });
  } catch (error) {
    if (base44 && user && draft && transitionedToApplying) {
      try {
        const config = getRepoConfig();
        const githubToken = await getGitHubToken(base44);
        const head = await getHead(githubToken, config);
        const recovered = await headRepresentsDraft(githubToken, config, head, draft.id);
        if (recovered) {
          const url = commitUrl(config, head);
          const updated = await base44.asServiceRole.entities.DesignDraft.update(draft.id, {
            status: "applied",
            applied_commit_sha: head,
            applied_commit_url: url,
            applied_by: user.id,
            approval_token_hash: null,
            approval_token_expires_at: null,
            failure_code: null,
            failure_message: null,
          });
          await audit(base44, {
            user_id: user.id,
            draft_id: draft.id,
            conversation_id: draft.conversation_id,
            event: "apply_succeeded",
            base_commit: draft.base_commit_sha,
            applied_commit: head,
            file_count: draft.file_count || 0,
            metadata: { recovered_after_error: true },
          });
          return ok({ already_applied: true, commit_sha: head, commit_url: url, draft: sanitizeDraft(updated) });
        }
      } catch {
        // fall through to safe state handling below
      }

      try {
        const current = await base44.asServiceRole.entities.DesignDraft.get(draft.id);
        if (current?.status === "applying") {
          const safeRetry = error instanceof DesignError && ["GITHUB_READ_FAILED", "GITHUB_WRITE_FAILED"].includes(error.code);
          if (safeRetry) {
            await transition(base44, current, "previewed", {
              approval_token_hash: null,
              approval_token_expires_at: null,
              failure_code: error.code,
              failure_message: error.message,
            });
          } else {
            await transition(base44, current, "failed", {
              approval_token_hash: null,
              approval_token_expires_at: null,
              failure_code: error instanceof DesignError ? error.code : "INTERNAL_ERROR",
              failure_message: error instanceof Error ? error.message : "Unexpected apply failure",
            });
          }
        }
        await audit(base44, {
          user_id: user.id,
          draft_id: draft.id,
          conversation_id: draft.conversation_id,
          event: "apply_failed",
          base_commit: draft.base_commit_sha,
          file_count: draft.file_count || 0,
          metadata: { code: error instanceof DesignError ? error.code : "INTERNAL_ERROR" },
        });
      } catch (stateError) {
        console.error("Failed to persist Creative Director failure state", stateError);
      }
    }
    return fail(error);
  }
});
