import { createClientFromRequest } from "npm:@base44/sdk";
import {
  DesignError,
  assertDraftOwner,
  audit,
  bodyJson,
  fail,
  getCommit,
  getGitHubToken,
  getHead,
  getRepoConfig,
  githubFetch,
  healthCheck,
  ok,
  readRepoFile,
  requireAdmin,
  sanitizeDraft,
  stageDraft,
  stageRevert,
  transition,
} from "../../shared/design.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await requireAdmin(base44);
    const input = await bodyJson(req);
    const action = input?.action;

    if (action === "health_check") {
      return ok(await healthCheck(base44, user));
    }

    if (action === "inspect_repo") {
      const token = await getGitHubToken(base44);
      const config = getRepoConfig();
      const head = await getHead(token, config);
      const commit = await getCommit(token, config, head);
      const tree = await githubFetch(
        token,
        `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`,
      );
      const files = (Array.isArray(tree?.tree) ? tree.tree : [])
        .filter((item: any) => item?.type === "blob")
        .map((item: any) => ({ path: item.path, sha: item.sha, size: item.size ?? null }))
        .filter((item: any) => item.path.startsWith("src/") || item.path.startsWith("public/") || [
          "package.json",
          "index.html",
          "vite.config.js",
          "vite.config.ts",
          "next.config.js",
          "next.config.mjs",
          "next.config.ts",
          "tailwind.config.js",
          "tailwind.config.ts",
          "postcss.config.js",
          "postcss.config.cjs",
          "postcss.config.mjs",
        ].includes(item.path))
        .slice(0, 2000);
      return ok({
        repository: `${config.owner}/${config.repo}`,
        branch: config.branch,
        head,
        files,
        truncated: (tree?.tree?.length || 0) > files.length,
      });
    }

    if (action === "read_files") {
      if (!Array.isArray(input?.paths) || input.paths.length === 0 || input.paths.length > 20) {
        throw new DesignError("INVALID_REQUEST", "read_files requires 1–20 approved frontend paths.");
      }
      const token = await getGitHubToken(base44);
      const config = getRepoConfig();
      const head = await getHead(token, config);
      const files = [];
      for (const path of input.paths) {
        const file = await readRepoFile(token, config, path, head);
        files.push(file ? { ...file, exists: true } : { path, exists: false, content: null, sha: null, size: 0 });
      }
      return ok({ head, files });
    }

    if (action === "stage_draft") {
      const draft = await stageDraft(base44, user, input);
      return ok({ draft }, 201);
    }

    if (action === "stage_revert") {
      const draft = await stageRevert(base44, user, input);
      return ok({ draft }, 201);
    }

    if (action === "list_drafts") {
      const query: Record<string, unknown> = { owner_user_id: user.id };
      if (typeof input?.conversation_id === "string" && input.conversation_id) query.conversation_id = input.conversation_id;
      const drafts = await base44.asServiceRole.entities.DesignDraft.filter(query, "-created_date", 30, 0);
      return ok({ drafts: drafts.map(sanitizeDraft) });
    }

    if (action === "reject_draft") {
      const draft = await base44.asServiceRole.entities.DesignDraft.get(input?.draft_id || "");
      assertDraftOwner(draft, user);
      if (!['staged', 'previewed'].includes(draft.status)) {
        throw new DesignError("INVALID_DRAFT_STATE", "Only staged or previewed drafts can be rejected.", 409);
      }
      const updated = draft.status === "previewed"
        ? await transition(base44, draft, "rejected", { approval_token_hash: null, approval_token_expires_at: null })
        : await base44.asServiceRole.entities.DesignDraft.update(draft.id, {
            status: "rejected",
            approval_token_hash: null,
            approval_token_expires_at: null,
          });
      await audit(base44, {
        user_id: user.id,
        draft_id: draft.id,
        conversation_id: draft.conversation_id,
        event: "draft_rejected",
        base_commit: draft.base_commit_sha,
        file_count: draft.file_count || 0,
      });
      return ok({ draft: sanitizeDraft(updated) });
    }

    throw new DesignError("INVALID_REQUEST", "Unknown design-workspace action.");
  } catch (error) {
    return fail(error);
  }
});
