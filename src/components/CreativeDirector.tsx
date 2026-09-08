"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/lib/base44Client";
import styles from "./CreativeDirector.module.css";

type Draft = {
  id: string;
  title: string;
  status: string;
  revision?: number;
  preview_revision?: number;
  preview_html?: string;
  target_summary?: string;
  file_count?: number;
  base_commit_sha?: string;
  applied_commit_sha?: string;
  applied_commit_url?: string;
  failure_code?: string;
  created_date?: string;
  revert_of_draft_id?: string;
};

type SelectionContext = {
  selector: string;
  tag_name: string;
  id: string;
  class_name: string;
  text: string;
  outer_html: string;
  rect: Record<string, number>;
  computed_style: Record<string, string>;
  screenshot_url?: string;
};

function unwrap<T = any>(value: any): T {
  return (value?.data ?? value) as T;
}

function errorData(error: any) {
  return error?.response?.data ?? error?.data ?? error ?? {};
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function selectorFor(element: Element) {
  if (element.id) return `#${cssEscape(element.id)}`;
  const pieces: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.body && pieces.length < 5) {
    let piece = node.tagName.toLowerCase();
    const classes = Array.from(node.classList).filter(Boolean).slice(0, 2);
    if (classes.length) piece += classes.map((name) => `.${cssEscape(name)}`).join("");
    const current: Element = node;
    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      if (sameTag.length > 1) piece += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
    }
    pieces.unshift(piece);
    node = parent;
  }
  return pieces.join(" > ");
}

function messageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!content) return "";
  try { return JSON.stringify(content, null, 2); } catch { return String(content); }
}

export function CreativeDirector() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "drafts" | "health">("chat");
  const [user, setUser] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [selectorMode, setSelectorMode] = useState(false);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<Draft | null>(null);
  const [approvalToken, setApprovalToken] = useState<string | null>(null);
  const [previewRegistering, setPreviewRegistering] = useState(false);
  const [applying, setApplying] = useState(false);
  const [staleDraftId, setStaleDraftId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);
  const highlightOutlineRef = useRef("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const invoke = useCallback(async (name: string, data: Record<string, unknown>) => {
    const raw = await base44.functions.invoke(name, data);
    return unwrap<any>(raw);
  }, []);

  const loadDrafts = useCallback(async () => {
    if (!user) return;
    try {
      const result = await invoke("design-workspace", {
        action: "list_drafts",
        ...(conversationId ? { conversation_id: conversationId } : {}),
      });
      setDrafts(Array.isArray(result?.drafts) ? result.drafts : []);
    } catch (error) {
      const data = errorData(error);
      setNotice({ type: "error", text: data?.message || "Could not load design drafts." });
    }
  }, [conversationId, invoke, user]);

  const loadHealth = useCallback(async () => {
    if (!user) return;
    try {
      const result = await invoke("design-workspace", { action: "health_check" });
      setHealth(result);
    } catch (error) {
      const data = errorData(error);
      setHealth({ checks: { auth: true }, details: { backend: data?.message || "Creative Director backend unavailable." } });
    }
  }, [invoke, user]);

  useEffect(() => {
    let active = true;
    base44.auth.me()
      .then((current) => { if (active) setUser(current); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    const timer = window.setTimeout(() => {
      loadHealth();
      loadDrafts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDrafts, loadHealth, open, user]);

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = base44.agents.subscribeToConversation(conversationId, (conversation: any) => {
      setMessages(Array.isArray(conversation?.messages) ? conversation.messages : []);
      const latest = conversation?.messages?.[conversation.messages.length - 1];
      if (latest?.role === "assistant") loadDrafts();
    });
    base44.agents.getConversation(conversationId).then((conversation: any) => {
      setMessages(Array.isArray(conversation?.messages) ? conversation.messages : []);
    }).catch(() => undefined);
    return unsubscribe;
  }, [conversationId, loadDrafts]);

  useEffect(() => {
    if (!selectorMode) return;

    const restore = () => {
      if (highlightedRef.current) highlightedRef.current.style.outline = highlightOutlineRef.current;
      highlightedRef.current = null;
    };

    const over = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || panelRef.current?.contains(target) || target.closest("[data-creative-director-ui='true']")) return;
      if (highlightedRef.current === target) return;
      restore();
      highlightedRef.current = target;
      highlightOutlineRef.current = target.style.outline;
      target.style.outline = "2px solid #6eb0ff";
    };

    const click = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || panelRef.current?.contains(target) || target.closest("[data-creative-director-ui='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      restore();
      setSelectorMode(false);
      setSelectionBusy(true);

      const rect = target.getBoundingClientRect();
      const computed = getComputedStyle(target);
      const context: SelectionContext = {
        selector: selectorFor(target),
        tag_name: target.tagName.toLowerCase(),
        id: target.id || "",
        class_name: target.className?.toString?.() || "",
        text: (target.innerText || target.textContent || "").trim().slice(0, 1200),
        outer_html: target.outerHTML.slice(0, 12000),
        rect: {
          x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height),
        },
        computed_style: {
          display: computed.display,
          position: computed.position,
          width: computed.width,
          height: computed.height,
          color: computed.color,
          background: computed.background,
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
          padding: computed.padding,
          margin: computed.margin,
          border: computed.border,
          borderRadius: computed.borderRadius,
          boxShadow: computed.boxShadow,
          transform: computed.transform,
          opacity: computed.opacity,
        },
      };

      try {
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(target, {
          useCORS: true,
          allowTaint: false,
          backgroundColor: null,
          logging: false,
          scale: Math.min(2, window.devicePixelRatio || 1),
        });
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
        if (blob) {
          const file = new File([blob], `creative-director-selection-${Date.now()}.png`, { type: "image/png" });
          const uploaded = await base44.integrations.Core.UploadFile({ file });
          if (uploaded?.file_url) context.screenshot_url = uploaded.file_url;
        }
      } catch (error) {
        console.warn("Creative Director screenshot capture failed", error);
      }

      setSelection(context);
      setSelectionBusy(false);
      setOpen(true);
      setTab("chat");
    };

    document.addEventListener("mouseover", over, true);
    document.addEventListener("click", click, true);
    document.body.style.cursor = "crosshair";
    return () => {
      restore();
      document.removeEventListener("mouseover", over, true);
      document.removeEventListener("click", click, true);
      document.body.style.cursor = "";
    };
  }, [selectorMode]);

  const ensureConversation = useCallback(async () => {
    if (conversationId) {
      const existing = await base44.agents.getConversation(conversationId);
      if (existing) return existing;
    }
    const created = await base44.agents.createConversation({
      agent_name: "creative_director",
      metadata: { surface: "embedded_creative_director", app_id: "6aa03b2a2e237d5d1ee4ff15" },
    });
    setConversationId(created.id);
    setMessages(created.messages || []);
    return created;
  }, [conversationId]);

  const sendMessage = useCallback(async (override?: string) => {
    const text = (override ?? prompt).trim();
    if (!text || sending || !user) return;
    setSending(true);
    setNotice(null);
    try {
      const conversation: any = await ensureConversation();
      const message: any = { role: "user", content: text };
      if (selection) {
        message.custom_context = [{
          type: "selected_dom_element",
          message: "The user selected this live DOM element. Inspect the real source before proposing changes.",
          data: selection,
        }];
        if (selection.screenshot_url) message.file_urls = [selection.screenshot_url];
      }
      await base44.agents.addMessage(conversation, message);
      setPrompt("");
      setSelection(null);
    } catch (error) {
      const data = errorData(error);
      setNotice({ type: "error", text: data?.message || "Could not send the design request." });
    } finally {
      setSending(false);
    }
  }, [ensureConversation, prompt, selection, sending, user]);

  const registerPreview = useCallback(async () => {
    if (!previewDraft || previewRegistering || approvalToken) return;
    setPreviewRegistering(true);
    setStaleDraftId(null);
    try {
      const result = await invoke("mark-design-draft-previewed", { draft_id: previewDraft.id });
      setApprovalToken(result?.approval_token || null);
      if (result?.draft) setPreviewDraft(result.draft);
      await loadDrafts();
    } catch (error) {
      const data = errorData(error);
      setNotice({ type: "error", text: data?.message || "The preview could not be securely registered." });
    } finally {
      setPreviewRegistering(false);
    }
  }, [approvalToken, invoke, loadDrafts, previewDraft, previewRegistering]);

  const applyDraft = useCallback(async () => {
    if (!previewDraft || !approvalToken || applying) return;
    setApplying(true);
    setNotice(null);
    const token = approvalToken;
    setApprovalToken(null);
    try {
      const result = await invoke("apply-design-draft", { draft_id: previewDraft.id, approval_token: token });
      setNotice({
        type: "success",
        text: result?.already_applied
          ? `Already applied at ${result.commit_sha}.`
          : `Committed atomically to GitHub main at ${result.commit_sha}. Base44 sync/publish remains a separate status.`
      });
      setPreviewDraft(null);
      await Promise.all([loadDrafts(), loadHealth()]);
    } catch (error) {
      const data = errorData(error);
      if (data?.code === "STALE_DRAFT") setStaleDraftId(previewDraft.id);
      setNotice({ type: "error", text: data?.message || "The design could not be applied." });
    } finally {
      setApplying(false);
    }
  }, [approvalToken, applying, invoke, loadDrafts, loadHealth, previewDraft]);

  const rejectDraft = useCallback(async (draft: Draft) => {
    try {
      await invoke("design-workspace", { action: "reject_draft", draft_id: draft.id });
      if (previewDraft?.id === draft.id) {
        setPreviewDraft(null);
        setApprovalToken(null);
      }
      await loadDrafts();
    } catch (error) {
      const data = errorData(error);
      setNotice({ type: "error", text: data?.message || "Could not reject the draft." });
    }
  }, [invoke, loadDrafts, previewDraft]);

  const refreshStale = useCallback(async (draftId: string) => {
    setPreviewDraft(null);
    setApprovalToken(null);
    setStaleDraftId(null);
    await sendMessage(`Refresh DesignDraft ${draftId} against the latest GitHub main HEAD. Inspect the current repository, re-read every affected file, rebuild it as a fresh superseding draft, and stage a new interactive preview. Do not force-apply or merge over newer work.`);
  }, [sendMessage]);

  const undoDraft = useCallback(async (draft: Draft) => {
    await sendMessage(`Undo DesignDraft ${draft.id}. Inspect the current repository state, create a reverse draft only if the affected files have not diverged, build an interactive preview of the reversal, and stage it for my approval. Do not apply it automatically.`);
    setTab("chat");
  }, [sendMessage]);

  const healthRows = useMemo(() => {
    const checks = health?.checks || {};
    return [
      ["Creative Director", checks.auth && checks.design_drafts && checks.creative_assets],
      ["Base44 Agent", true],
      ["Draft Storage", checks.design_drafts],
      ["GitHub", checks.github_connector],
      ["Repository", checks.repository],
      ["Branch main", checks.main_branch],
      ["AI Image Generation", checks.ai_image_generation ?? true],
      ["AI Video Generation", checks.ai_video_generation ?? false],
    ] as Array<[string, boolean]>;
  }, [health]);

  return (
    <>
      {user?.role === "admin" && (
        <button
          type="button"
          className={styles.launcher}
          data-creative-director-ui="true"
          onClick={() => setOpen(true)}
          aria-label="Open Creative Director"
        >
          Creative Director
        </button>
      )}

      {open && (
        <div className={styles.panel} ref={panelRef} data-creative-director-ui="true">
          <div className={styles.header}>
            <div className={styles.titleWrap}>
              <div className={styles.title}>Creative Director</div>
              <div className={styles.subtitle}>Preview first · atomic apply · no force push</div>
            </div>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => { setSelectorMode(true); setOpen(false); }}
                disabled={!user || selectorMode}
              >
                {selectionBusy ? "Capturing…" : "Select element"}
              </button>
              <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close Creative Director">×</button>
            </div>
          </div>

          <div className={styles.tabs}>
            {(["chat", "drafts", "health"] as const).map((name) => (
              <button
                type="button"
                key={name}
                className={`${styles.tab} ${tab === name ? styles.tabActive : ""}`}
                onClick={() => setTab(name)}
              >
                {name === "chat" ? "Chat" : name === "drafts" ? "Drafts" : "Diagnostics"}
              </button>
            ))}
          </div>

          {!authChecked ? (
            <div className={styles.empty}>Checking Creative Director access…</div>
          ) : !user ? (
            <div className={styles.signIn}>
              <div>
                <div className={styles.title}>Administrator sign-in required</div>
                <p>The design agent, draft storage and GitHub mutations are unavailable until you authenticate.</p>
              </div>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => base44.auth.loginWithProvider("google", window.location.href)}
              >
                Sign in with Google
              </button>
            </div>
          ) : user.role !== "admin" ? (
            <div className={styles.signIn}>
              <div>
                <div className={styles.title}>Creative Director access restricted</div>
                <p>This surface is available only to authorised application administrators.</p>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.body}>
                {notice && <div className={`${styles.notice} ${notice.type === "error" ? styles.error : notice.type === "success" ? styles.success : ""}`}>{notice.text}</div>}

                {tab === "chat" && (
                  <>
                    {selection && (
                      <div className={styles.selection}>
                        <strong>Selected live element</strong>
                        <code>{selection.selector}</code>
                        <span>{selection.screenshot_url ? "Screenshot attached for the agent." : "DOM context captured; screenshot was unavailable."}</span>
                      </div>
                    )}
                    <div className={styles.messages}>
                      {messages.length === 0 && (
                        <div className={styles.empty}>Select an element or describe a change. Nothing is committed until you open the preview and explicitly press Apply Design.</div>
                      )}
                      {messages.filter((message) => !message.hidden).map((message, index) => (
                        <div key={message.id || index} className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`}>
                          {messageText(message.content)}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {tab === "drafts" && (
                  <div className={styles.draftList}>
                    {drafts.length === 0 && <div className={styles.empty}>No design drafts yet.</div>}
                    {drafts.map((draft) => (
                      <div className={styles.draftCard} key={draft.id}>
                        <div className={styles.draftTop}>
                          <div>
                            <div className={styles.draftTitle}>{draft.title}</div>
                            <div className={styles.meta}>rev {draft.revision || 1} · {draft.file_count || 0} file{draft.file_count === 1 ? "" : "s"}</div>
                          </div>
                          <div className={styles.status}>{draft.status}</div>
                        </div>
                        {draft.target_summary && <div className={styles.draftSummary}>{draft.target_summary}</div>}
                        {draft.failure_code && <div className={`${styles.notice} ${styles.error}`}>{draft.failure_code}</div>}
                        <div className={styles.draftActions}>
                          {['staged', 'previewed'].includes(draft.status) && draft.preview_html && (
                            <button type="button" className={styles.primaryButton} onClick={() => { setPreviewDraft(draft); setApprovalToken(null); setStaleDraftId(null); }}>Open preview</button>
                          )}
                          {['staged', 'previewed'].includes(draft.status) && (
                            <button type="button" className={styles.dangerButton} onClick={() => rejectDraft(draft)}>Reject</button>
                          )}
                          {draft.status === "applied" && (
                            <button type="button" className={styles.smallButton} onClick={() => undoDraft(draft)}>Undo…</button>
                          )}
                          {draft.applied_commit_url && (
                            <a className={styles.smallButton} href={draft.applied_commit_url} target="_blank" rel="noreferrer">Commit</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "health" && (
                  <div className={styles.healthGrid}>
                    {healthRows.map(([label, ready]) => (
                      <div className={styles.healthRow} key={label}>
                        <span>{label}</span>
                        <span className={`${styles.healthValue} ${ready ? styles.ready : styles.notReady}`}>{ready ? "Ready" : "Unavailable"}</span>
                      </div>
                    ))}
                    {health?.details && Object.values(health.details).filter(Boolean).map((detail: any, index) => (
                      <div className={styles.detail} key={index}>{String(detail)}</div>
                    ))}
                  </div>
                )}
              </div>

              {tab === "chat" && (
                <div className={styles.composer}>
                  <textarea
                    className={styles.textarea}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe the design change…"
                    aria-label="Creative Director request"
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") sendMessage();
                    }}
                  />
                  <div className={styles.composerRow}>
                    <button type="button" className={styles.smallButton} onClick={() => { setSelectorMode(true); setOpen(false); }}>Select element</button>
                    <button type="button" className={styles.primaryButton} onClick={() => sendMessage()} disabled={sending || !prompt.trim()}>{sending ? "Sending…" : "Send"}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {previewDraft && (
        <div className={styles.modalBackdrop} data-creative-director-ui="true">
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>{previewDraft.title}</div>
                <div className={styles.modalStatus}>rev {previewDraft.revision || 1} · sandbox: allow-scripts</div>
              </div>
              <button type="button" className={styles.iconButton} onClick={() => { setPreviewDraft(null); setApprovalToken(null); setStaleDraftId(null); }} aria-label="Close preview">×</button>
            </div>
            <iframe
              key={`${previewDraft.id}-${previewDraft.revision || 1}`}
              className={styles.previewFrame}
              srcDoc={previewDraft.preview_html || ""}
              sandbox="allow-scripts"
              onLoad={registerPreview}
              title={`Preview: ${previewDraft.title}`}
            />
            <div className={styles.modalFooter}>
              <div className={styles.modalStatus}>
                {previewRegistering ? "Registering secure preview…" : approvalToken ? "Preview loaded · one-time approval ready" : staleDraftId ? "Repository changed since this preview" : "Apply remains disabled until the preview loads"}
              </div>
              <div className={styles.modalButtons}>
                <button type="button" className={styles.dangerButton} onClick={() => rejectDraft(previewDraft)}>Reject</button>
                {staleDraftId ? (
                  <button type="button" className={styles.primaryButton} onClick={() => refreshStale(staleDraftId)}>Refresh design</button>
                ) : (
                  <button type="button" className={styles.primaryButton} onClick={applyDraft} disabled={!approvalToken || applying || previewRegistering}>{applying ? "Applying…" : "Apply Design"}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
