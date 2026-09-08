export const LIMITS = {
  maxFiles: 40,
  maxTextFileBytes: 1_048_576,
  maxAggregateTextBytes: 8_388_608,
  maxPreviewBytes: 2_097_152,
  maxAssetBytes: 20_971_520,
  maxAssets: 30,
  approvalMinutes: 15,
};

const ALLOWED_PREFIXES = ["src/", "public/"];
const ALLOWED_ROOT_FILES = new Set([
  "package.json",
  "index.html",
  "vite.config.js",
  "vite.config.ts",
  "tailwind.config.js",
  "tailwind.config.ts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
]);

export class DesignError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "DesignError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function ok(data: Record<string, unknown> = {}, status = 200) {
  return Response.json({ ok: true, ...data }, { status });
}

export function fail(error: unknown) {
  if (error instanceof DesignError) {
    return Response.json(
      { ok: false, code: error.code, message: error.message, ...(error.details || {}) },
      { status: error.status },
    );
  }
  console.error("Creative Director backend error", error);
  return Response.json(
    { ok: false, code: "INTERNAL_ERROR", message: "The Creative Director backend encountered an unexpected error." },
    { status: 500 },
  );
}

export async function bodyJson(req: Request) {
  try {
    return await req.json();
  } catch {
    throw new DesignError("INVALID_REQUEST", "A valid JSON request body is required.", 400);
  }
}

export async function requireAdmin(base44: any) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new DesignError("UNAUTHORIZED", "Authentication is required.", 401);
  if (user.role !== "admin") throw new DesignError("FORBIDDEN", "Creative Director access is restricted to authorised administrators.", 403);
  return user;
}

export function assertDraftOwner(draft: any, user: any) {
  if (!draft || draft.owner_user_id !== user.id) {
    throw new DesignError("DRAFT_NOT_FOUND", "Design draft not found.", 404);
  }
}

export function normalizeAndValidatePath(input: unknown) {
  if (typeof input !== "string" || !input.trim()) throw new DesignError("INVALID_PATH", "Every edit requires a file path.");
  if (input.includes("\0")) throw new DesignError("INVALID_PATH", "NUL characters are not allowed in paths.");
  const raw = input.replaceAll("\\", "/").trim();
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new DesignError("INVALID_PATH", "Absolute paths are not allowed.");
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) throw new DesignError("INVALID_PATH", "Path traversal is not allowed.");
  const path = parts.join("/");
  const allowed = ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)) || ALLOWED_ROOT_FILES.has(path);
  if (!allowed) throw new DesignError("INVALID_PATH", `Edits are not allowed outside approved frontend paths: ${path}`);
  const forbidden = [".env", ".git/", ".github/", "node_modules/", "base44/", "credentials", "private_key", "id_rsa"];
  if (forbidden.some((item) => path === item || path.startsWith(item))) {
    throw new DesignError("INVALID_PATH", `Protected path rejected: ${path}`);
  }
  return path;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function validatePackageJson(before: string | null, after: string) {
  let previous: any;
  let proposed: any;
  try {
    previous = before ? JSON.parse(before) : {};
    proposed = JSON.parse(after);
  } catch {
    throw new DesignError("INVALID_REQUEST", "package.json must remain valid JSON.");
  }
  for (const section of ["scripts", "dependencies", "devDependencies", "peerDependencies"]) {
    const oldEntries = previous?.[section] || {};
    const newEntries = proposed?.[section] || {};
    for (const key of Object.keys(oldEntries)) {
      if (!(key in newEntries)) {
        throw new DesignError("INVALID_REQUEST", `package.json may not silently remove existing ${section} entry: ${key}`);
      }
    }
  }
  if (previous?.dependencies?.["@base44/sdk"] && !proposed?.dependencies?.["@base44/sdk"]) {
    throw new DesignError("INVALID_REQUEST", "The Base44 SDK dependency may not be removed.");
  }
}

export function getRepoConfig() {
  const owner = Deno.env.get("DESIGN_GITHUB_OWNER")?.trim();
  const repo = Deno.env.get("DESIGN_GITHUB_REPO")?.trim();
  const branch = Deno.env.get("DESIGN_GITHUB_BRANCH")?.trim() || "main";
  if (!owner || !repo) {
    throw new DesignError(
      "GITHUB_REPOSITORY_NOT_CONFIGURED",
      "GitHub is not fully configured for Creative Director. Set DESIGN_GITHUB_OWNER and DESIGN_GITHUB_REPO for this app.",
      503,
    );
  }
  return { owner, repo, branch };
}

export async function getGitHubToken(base44: any) {
  try {
    const connection = await base44.asServiceRole.connectors.getConnection("github");
    if (!connection?.accessToken) throw new Error("missing token");
    return connection.accessToken as string;
  } catch {
    throw new DesignError("GITHUB_NOT_CONNECTED", "The GitHub connector is not connected.", 503);
  }
}

export async function githubFetch(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const safe = await response.json().catch(() => ({}));
    const message = typeof safe?.message === "string" ? safe.message : `GitHub returned ${response.status}`;
    const code = response.status >= 500 ? "GITHUB_READ_FAILED" : "GITHUB_WRITE_FAILED";
    throw new DesignError(code, message, response.status >= 500 ? 502 : response.status);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function getHead(token: string, config: ReturnType<typeof getRepoConfig>) {
  const ref = await githubFetch(token, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  return ref.object.sha as string;
}

export async function getCommit(token: string, config: ReturnType<typeof getRepoConfig>, sha: string) {
  return githubFetch(token, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/commits/${encodeURIComponent(sha)}`);
}

export async function readRepoFile(token: string, config: ReturnType<typeof getRepoConfig>, path: string, ref: string) {
  const clean = normalizeAndValidatePath(path);
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${clean.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new DesignError("GITHUB_READ_FAILED", `Could not read ${clean} from GitHub.`, 502);
  const data = await response.json();
  if (data.type !== "file") throw new DesignError("INVALID_PATH", `${clean} is not a regular file.`);
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new DesignError("GITHUB_READ_FAILED", `${clean} is not available as text content.`, 422);
  }
  const binary = atob(data.content.replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DesignError("INVALID_REQUEST", `Binary file edits are not accepted through the text draft pipeline: ${clean}`);
  }
  return { path: clean, content, sha: data.sha as string, size: data.size as number };
}

export async function validateAndHydrateEdits(
  token: string,
  config: ReturnType<typeof getRepoConfig>,
  baseSha: string,
  rawEdits: unknown,
) {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) throw new DesignError("INVALID_REQUEST", "A design draft must contain at least one edit.");
  if (rawEdits.length > LIMITS.maxFiles) throw new DesignError("PAYLOAD_TOO_LARGE", `A draft may change at most ${LIMITS.maxFiles} files.`);

  const seen = new Set<string>();
  let aggregate = 0;
  const edits = [];
  for (const raw of rawEdits) {
    const path = normalizeAndValidatePath(raw?.path);
    if (seen.has(path)) throw new DesignError("INVALID_REQUEST", `Duplicate edit path: ${path}`);
    seen.add(path);
    const isDelete = raw?.delete === true;
    const content = isDelete ? null : raw?.content;
    if (!isDelete && typeof content !== "string") throw new DesignError("INVALID_REQUEST", `Text content is required for ${path}.`);
    if (typeof content === "string") {
      const size = byteLength(content);
      if (size > LIMITS.maxTextFileBytes) throw new DesignError("PAYLOAD_TOO_LARGE", `${path} exceeds the 1 MB text-file limit.`);
      aggregate += size;
      if (aggregate > LIMITS.maxAggregateTextBytes) throw new DesignError("PAYLOAD_TOO_LARGE", "The aggregate text edit payload exceeds 8 MB.");
      if (content.includes("\u0000")) throw new DesignError("INVALID_REQUEST", `Unexpected binary/NUL data in ${path}.`);
    }
    const before = await readRepoFile(token, config, path, baseSha);
    if (isDelete && !before) throw new DesignError("INVALID_REQUEST", `Cannot delete a file that does not exist: ${path}`);
    if (path === "package.json" && typeof content === "string") validatePackageJson(before?.content ?? null, content);
    edits.push({
      path,
      delete: isDelete,
      before_content: before?.content ?? null,
      before_sha: before?.sha ?? null,
      after_content: content,
    });
  }
  return { edits, aggregateBytes: aggregate };
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function audit(base44: any, payload: Record<string, unknown>) {
  try {
    await base44.asServiceRole.entities.DesignAudit.create(payload);
  } catch (error) {
    console.error("Creative Director audit write failed", error);
  }
}

const TRANSITIONS: Record<string, string[]> = {
  staged: ["previewed", "rejected"],
  previewed: ["applying", "staged", "rejected", "superseded"],
  applying: ["applied", "previewed", "failed"],
  applied: [],
  rejected: [],
  superseded: [],
  failed: [],
};

export async function transition(base44: any, draft: any, next: string, patch: Record<string, unknown> = {}) {
  if (!TRANSITIONS[draft.status]?.includes(next)) {
    throw new DesignError("INVALID_DRAFT_STATE", `Illegal draft transition: ${draft.status} → ${next}`, 409);
  }
  return base44.asServiceRole.entities.DesignDraft.update(draft.id, { status: next, ...patch });
}

export function sanitizeDraft(draft: any) {
  if (!draft) return null;
  const {
    approval_token_hash,
    approval_token_expires_at,
    failure_message,
    owner_user_id,
    applied_by,
    previewed_by,
    edits,
    ...safe
  } = draft;
  return safe;
}

export async function stageDraft(base44: any, user: any, input: any) {
  const title = typeof input?.title === "string" && input.title.trim() ? input.title.trim().slice(0, 180) : "Creative Director design change";
  const conversationId = typeof input?.conversation_id === "string" ? input.conversation_id : "";
  if (!conversationId) throw new DesignError("INVALID_REQUEST", "conversation_id is required.");
  const previewHtml = typeof input?.preview_html === "string" ? input.preview_html : "";
  if (!previewHtml.trim()) throw new DesignError("INVALID_REQUEST", "A functioning preview_html document is required before staging.");
  if (byteLength(previewHtml) > LIMITS.maxPreviewBytes) throw new DesignError("PAYLOAD_TOO_LARGE", "Preview HTML exceeds 2 MB.");

  const config = getRepoConfig();
  const token = await getGitHubToken(base44);
  const baseCommitSha = await getHead(token, config);
  const hydrated = await validateAndHydrateEdits(token, config, baseCommitSha, input?.edits);

  let revision = 1;
  let supersedesDraftId: string | undefined;
  if (input?.supersedes_draft_id) {
    const previous = await base44.asServiceRole.entities.DesignDraft.get(input.supersedes_draft_id);
    assertDraftOwner(previous, user);
    if (!['staged', 'previewed'].includes(previous.status)) {
      throw new DesignError("INVALID_DRAFT_STATE", "Only staged or previewed drafts may be superseded.", 409);
    }
    revision = Number(previous.revision || 1) + 1;
    supersedesDraftId = previous.id;
    if (previous.status === "previewed") await transition(base44, previous, "superseded", { approval_token_hash: null, approval_token_expires_at: null });
    else await base44.asServiceRole.entities.DesignDraft.update(previous.id, { status: "rejected", approval_token_hash: null, approval_token_expires_at: null });
  }

  const draft = await base44.asServiceRole.entities.DesignDraft.create({
    title,
    owner_user_id: user.id,
    conversation_id: conversationId,
    created_by: user.email || user.id,
    status: "staged",
    revision,
    preview_revision: null,
    approval_token_hash: null,
    approval_token_expires_at: null,
    base_commit_sha: baseCommitSha,
    applied_commit_sha: null,
    applied_commit_url: null,
    applied_by: null,
    previewed_by: null,
    failure_code: null,
    failure_message: null,
    preview_html: previewHtml,
    edits: hydrated.edits,
    file_count: hydrated.edits.length,
    aggregate_bytes: hydrated.aggregateBytes,
    supersedes_draft_id: supersedesDraftId || null,
    revert_of_draft_id: input?.revert_of_draft_id || null,
    commit_message: typeof input?.commit_message === "string" ? input.commit_message.slice(0, 180) : title,
    target_summary: typeof input?.target_summary === "string" ? input.target_summary.slice(0, 500) : "",
  });
  await audit(base44, {
    user_id: user.id,
    draft_id: draft.id,
    conversation_id: conversationId,
    event: "draft_created",
    base_commit: baseCommitSha,
    file_count: hydrated.edits.length,
  });
  return sanitizeDraft(draft);
}

export async function stageRevert(base44: any, user: any, input: any) {
  const original = await base44.asServiceRole.entities.DesignDraft.get(input?.draft_id || "");
  assertDraftOwner(original, user);
  if (original.status !== "applied") throw new DesignError("INVALID_DRAFT_STATE", "Only applied drafts can be undone.", 409);
  const previewHtml = typeof input?.preview_html === "string" ? input.preview_html : "";
  if (!previewHtml.trim()) throw new DesignError("INVALID_REQUEST", "Undo must include a preview_html document.");
  if (byteLength(previewHtml) > LIMITS.maxPreviewBytes) throw new DesignError("PAYLOAD_TOO_LARGE", "Preview HTML exceeds 2 MB.");

  const config = getRepoConfig();
  const token = await getGitHubToken(base44);
  const head = await getHead(token, config);
  const reverseEdits = [];
  for (const edit of original.edits || []) {
    const current = await readRepoFile(token, config, edit.path, head);
    if (edit.delete) {
      if (current) throw new DesignError("STALE_DRAFT", `Cannot undo because ${edit.path} has diverged.`, 409, { expected_head: original.applied_commit_sha, actual_head: head });
    } else if (!current || current.content !== edit.after_content) {
      throw new DesignError("STALE_DRAFT", `Cannot undo because ${edit.path} has diverged.`, 409, { expected_head: original.applied_commit_sha, actual_head: head });
    }
    if (edit.before_content === null) reverseEdits.push({ path: edit.path, delete: true });
    else reverseEdits.push({ path: edit.path, content: edit.before_content, delete: false });
  }
  const draft = await stageDraft(base44, user, {
    title: `Undo: ${original.title}`,
    conversation_id: input?.conversation_id || original.conversation_id,
    preview_html: previewHtml,
    edits: reverseEdits,
    revert_of_draft_id: original.id,
    commit_message: `revert design: ${original.title}`,
    target_summary: `Preview-first reversal of DesignDraft ${original.id}`,
  });
  await audit(base44, {
    user_id: user.id,
    draft_id: draft.id,
    conversation_id: input?.conversation_id || original.conversation_id,
    event: "revert_staged",
    base_commit: head,
    file_count: reverseEdits.length,
    metadata: { reverts_draft_id: original.id },
  });
  return draft;
}

export async function createAtomicCommit(
  token: string,
  config: ReturnType<typeof getRepoConfig>,
  baseSha: string,
  edits: any[],
  message: string,
) {
  const baseCommit = await getCommit(token, config, baseSha);
  const treeEntries = [];
  for (const edit of edits) {
    if (edit.delete) {
      treeEntries.push({ path: edit.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await githubFetch(token, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: edit.after_content, encoding: "utf-8" }),
    });
    treeEntries.push({ path: edit.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const tree = await githubFetch(token, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
  });
  const commit = await githubFetch(token, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
  });
  await githubFetch(token, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return commit;
}

export async function headRepresentsDraft(token: string, config: ReturnType<typeof getRepoConfig>, head: string, draftId: string) {
  const commit = await getCommit(token, config, head);
  return typeof commit?.message === "string" && commit.message.includes(`DesignDraft: ${draftId}`) ? commit : null;
}

export async function healthCheck(base44: any, user: any) {
  const checks: Record<string, boolean> = {
    auth: true,
    github_connector: false,
    repository: false,
    main_branch: false,
    design_drafts: false,
    creative_assets: false,
  };
  const details: Record<string, string> = {};
  try {
    await base44.asServiceRole.entities.DesignDraft.list("-created_date", 1);
    checks.design_drafts = true;
  } catch { details.design_drafts = "DesignDraft entity is unavailable."; }
  try {
    await base44.asServiceRole.entities.CreativeAsset.list("-created_date", 1);
    checks.creative_assets = true;
  } catch { details.creative_assets = "CreativeAsset entity is unavailable."; }
  let token: string | null = null;
  try { token = await getGitHubToken(base44); checks.github_connector = true; }
  catch { details.github_connector = "GitHub OAuth is not connected."; }
  if (token) {
    try {
      const config = getRepoConfig();
      checks.repository = true;
      await getHead(token, config);
      checks.main_branch = true;
      details.branch = config.branch;
      details.repository = `${config.owner}/${config.repo}`;
    } catch (error) {
      details.repository = error instanceof Error ? error.message : "Repository configuration is incomplete.";
    }
  }
  return { user: { id: user.id, role: user.role }, checks, details };
}
