import { parseFragment, serialize } from 'parse5';
import { footerCopy, navCopy, sectionCopy } from '@/data/bea-copy';

type AstNode = any;
type AstElement = any;

const EXCLUDED_TAGS = new Set(['script', 'style', 'svg', 'defs', 'path', 'template', 'noscript', 'canvas', 'video', 'source', 'picture']);
const EXACT_REPLACE_EXCLUDED_TAGS = new Set(['script', 'style', 'defs', 'path', 'template', 'noscript']);

const SECTION_HEADERS: Record<string, { oldTitle: string; title: string; strapline: string }> = {
  sidekick: { oldTitle: 'SIDEKICK', title: 'THE METHOD', strapline: 'Study the decision. Practise the move. Finish the work.' },
  agentic: { oldTitle: 'AGENTIC COMMERCE', title: 'YOUR PATH', strapline: 'One piece of writing. Repeatedly improved.' },
  online: { oldTitle: 'SELL ONLINE', title: 'THE COURSES', strapline: 'Different rooms. Different problems. The same active method.' },
  retail: { oldTitle: 'SELL IN PERSON', title: 'THE PRACTICE LAB', strapline: 'Do the smallest useful version first.' },
  marketing: { oldTitle: 'MARKETING', title: 'FEEDBACK', strapline: 'Specific enough to change the next draft.' },
  checkout: { oldTitle: 'CHECKOUT', title: 'REVISION', strapline: 'Do not polish everything. Change something.' },
  operations: { oldTitle: 'RUN YOUR BUSINESS', title: 'FINISH THE WORK', strapline: 'A course should produce more than completed lessons.' },
  'shop-app': { oldTitle: 'SHOP APP', title: 'THE PROMPT ROOM', strapline: 'Prompts that teach you something about your writing.' },
  b2b: { oldTitle: 'B2B', title: 'YOUR ARCHIVE', strapline: 'Keep what you notice.' },
  finance: { oldTitle: 'MONEY', title: 'SUPPORT', strapline: 'Enough structure to keep moving. Enough freedom to remain a writer.' },
  shipping: { oldTitle: 'SHIPPING', title: 'WHAT CHANGES', strapline: 'Judge the course by the work it helps you make.' },
  developer: { oldTitle: 'DEVELOPER PLATFORM', title: 'QUESTIONS', strapline: 'Everything worth knowing before you begin.' },
};
const PRIMARY_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'button', 'li', 'dt', 'dd', 'figcaption']);
const BLOCK_DESCENDANT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd']);
const TEXT_CLASS_RE = /(headline|bodycopy|narrative|eyebrow|label|title|subtitle|heading|copy|caption|cta|button|link|text)/i;
const UTILITY_RE = /^(close|close modal|pause|play|previous|next|open menu|menu|mute|unmute|loading|skip|back to top)$/i;

function isElement(node: AstNode): node is AstElement {
  return Boolean(node && typeof node.tagName === 'string');
}

function attr(node: AstElement, name: string): string | undefined {
  return node.attrs?.find((item: { name: string; value: string }) => item.name === name)?.value;
}

function className(node: AstElement): string {
  return attr(node, 'class') ?? '';
}

function normalize(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function textNodes(node: AstNode, output: AstNode[] = []): AstNode[] {
  if (!node) return output;
  if (node.nodeName === '#text') {
    if (normalize(node.value ?? '')) output.push(node);
    return output;
  }
  if (isElement(node) && EXCLUDED_TAGS.has(node.tagName)) return output;
  for (const child of node.childNodes ?? []) textNodes(child, output);
  return output;
}

function elementText(node: AstElement): string {
  return normalize(textNodes(node).map((item) => item.value ?? '').join(' '));
}

function hasDescendantTag(node: AstNode, tags: Set<string>): boolean {
  for (const child of node.childNodes ?? []) {
    if (isElement(child) && tags.has(child.tagName)) return true;
    if (hasDescendantTag(child, tags)) return true;
  }
  return false;
}

function isUtility(node: AstElement, value: string): boolean {
  const cls = className(node);
  if (/sr-only|visually-hidden/i.test(cls)) return true;
  const aria = attr(node, 'aria-label');
  if (aria && UTILITY_RE.test(normalize(aria))) return true;
  return UTILITY_RE.test(value);
}

function isCandidate(node: AstElement): boolean {
  if (EXCLUDED_TAGS.has(node.tagName)) return false;
  const value = elementText(node);
  if (!value || isUtility(node, value)) return false;

  if (PRIMARY_TAGS.has(node.tagName)) return true;

  if (node.tagName === 'a') {
    return !hasDescendantTag(node, BLOCK_DESCENDANT_TAGS);
  }

  if (node.tagName === 'div' || node.tagName === 'span') {
    if (!TEXT_CLASS_RE.test(className(node))) return false;
    return !hasDescendantTag(node, new Set([...PRIMARY_TAGS, 'a']));
  }

  return false;
}

function collectBlocks(root: AstNode): AstElement[] {
  const blocks: AstElement[] = [];

  const walk = (node: AstNode, blockedByCandidate = false) => {
    if (isElement(node) && EXCLUDED_TAGS.has(node.tagName)) return;

    if (isElement(node) && !blockedByCandidate && isCandidate(node)) {
      blocks.push(node);
      return;
    }

    for (const child of node.childNodes ?? []) walk(child, blockedByCandidate);
  };

  walk(root);
  return blocks;
}

function distributeText(node: AstElement, replacement: string) {
  const nodes = textNodes(node);
  if (!nodes.length) return;

  if (!replacement) {
    for (const textNode of nodes) textNode.value = '';
    return;
  }

  if (nodes.length === 1) {
    nodes[0].value = replacement;
    return;
  }

  const words = replacement.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    nodes[0].value = replacement;
    for (let index = 1; index < nodes.length; index += 1) nodes[index].value = '';
    return;
  }

  const active = Math.min(nodes.length, words.length);
  const chunkSize = Math.ceil(words.length / active);
  let cursor = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    if (index < active) {
      const chunk = words.slice(cursor, cursor + chunkSize);
      cursor += chunk.length;
      nodes[index].value = `${index === 0 ? '' : ' '}${chunk.join(' ')}`;
    } else {
      nodes[index].value = '';
    }
  }

  if (cursor < words.length) {
    nodes[active - 1].value += ` ${words.slice(cursor).join(' ')}`;
  }
}

function findBySectionId(root: AstNode, sectionId: string): AstElement | undefined {
  if (isElement(root) && attr(root, 'data-section-id') === sectionId) return root;
  for (const child of root.childNodes ?? []) {
    const found = findBySectionId(child, sectionId);
    if (found) return found;
  }
  return undefined;
}

function findDeepestExactTextElement(root: AstNode, target: string): AstElement | undefined {
  let found: AstElement | undefined;
  const wanted = normalize(target).toLowerCase();

  const walk = (node: AstNode) => {
    if (!node) return;
    if (isElement(node) && EXACT_REPLACE_EXCLUDED_TAGS.has(node.tagName)) return;
    for (const child of node.childNodes ?? []) walk(child);
    if (isElement(node) && normalize(elementText(node)).toLowerCase() === wanted) found = node;
  };

  walk(root);
  return found;
}

function insertAfter(reference: AstElement, html: string) {
  const parent = reference.parentNode as AstElement | undefined;
  if (!parent?.childNodes) return;
  const index = parent.childNodes.indexOf(reference);
  if (index < 0) return;
  const fragment = parseFragment(html);
  const nodes = fragment.childNodes ?? [];
  for (const node of nodes) node.parentNode = parent;
  parent.childNodes.splice(index + 1, 0, ...nodes);
}

function applySectionHeader(section: AstElement, config: { oldTitle: string; title: string; strapline: string }) {
  const titleElement = findDeepestExactTextElement(section, config.oldTitle);
  if (!titleElement) return;
  distributeText(titleElement, config.title);
  insertAfter(
    titleElement,
    `<p data-bea-section-strapline="true" class="bodycopy-1" style="max-width:56rem;margin-top:1rem">${escapeHtml(config.strapline)}</p>`,
  );
}

function findFooter(root: AstNode): AstElement | undefined {
  if (isElement(root) && (root.tagName === 'footer' || /footer/i.test(className(root)))) return root;
  for (const child of root.childNodes ?? []) {
    const found = findFooter(child);
    if (found) return found;
  }
  return undefined;
}

function uniqueBlockGroups(root: AstNode): Array<{ original: string; blocks: AstElement[] }> {
  const groups = new Map<string, AstElement[]>();
  for (const block of collectBlocks(root)) {
    const value = elementText(block);
    if (!value) continue;
    const existing = groups.get(value);
    if (existing) existing.push(block);
    else groups.set(value, [block]);
  }
  return [...groups.entries()].map(([original, blocks]) => ({ original, blocks }));
}

function applyOrderedCopy(root: AstNode, replacements: string[]) {
  const groups = uniqueBlockGroups(root);

  groups.forEach((group, index) => {
    const replacement = replacements[index] ?? '';
    group.blocks.forEach((block) => distributeText(block, replacement));
  });

  // If the captured source has fewer authored text blocks than the new chapter,
  // keep every requested line visible without disturbing the existing graphics.
  if (replacements.length > groups.length && isElement(root)) {
    const overflow = replacements.slice(groups.length);
    const fragment = parseFragment(
      `<div class="bea-copy-overflow" style="position:relative;z-index:12;max-width:920px;margin:0 auto;padding:clamp(32px,6vw,96px) clamp(20px,4vw,64px);display:grid;gap:18px">${overflow
        .map((line, index) => `<p class="${index % 3 === 0 ? 'headline-4' : 'bodycopy-1'}">${escapeHtml(line)}</p>`)
        .join('')}</div>`,
    );
    root.childNodes ??= [];
    for (const child of fragment.childNodes ?? []) {
      child.parentNode = root;
      root.childNodes.push(child);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function replaceExactText(root: AstNode, map: Map<string, string>) {
  const walk = (node: AstNode) => {
    if (isElement(node) && EXACT_REPLACE_EXCLUDED_TAGS.has(node.tagName)) return;
    if (node.nodeName === '#text') {
      const current = normalize(node.value ?? '');
      const replacement = map.get(current);
      if (replacement !== undefined) node.value = replacement;
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
}

function replaceBrandResidue(root: AstNode) {
  const walk = (node: AstNode) => {
    if (isElement(node) && EXACT_REPLACE_EXCLUDED_TAGS.has(node.tagName)) return;
    if (node.nodeName === '#text' && typeof node.value === 'string') {
      node.value = node.value
        .replace(/Shopify Editions/gi, 'Bea Sophia Writing School')
        .replace(/Shopify/gi, 'Bea Sophia');
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
}

export function applyBeaCopy(html: string): string {
  const document = parseFragment(html);

  // Replace chapter headers in their own section before changing repeated nav labels.
  for (const [sectionId, config] of Object.entries(SECTION_HEADERS)) {
    const section = findBySectionId(document, sectionId);
    if (section) applySectionHeader(section, config);
  }

  const globalMap = new Map<string, string>([
    ...navCopy.map(([from, to]) => [from, to] as [string, string]),
    ["What's new", 'Courses'],
    ['Changelog', 'Prompt Room'],
    ['Editions', 'Writing School'],
    ['Shopify', 'BEA SOPHIA'],
    ['Get notified', 'Join the newsletter'],
    ['This feature will be available soon. Sign up to get notified.', 'New courses, prompts and practice notes, sent occasionally.'],
    ['Loading product...', 'Loading course...'],
  ]);
  replaceExactText(document, globalMap);

  for (const [sectionId, copy] of Object.entries(sectionCopy)) {
    const section = findBySectionId(document, sectionId);
    if (!section) continue;

    if (sectionId === 'hero') {
      applyOrderedCopy(section, copy);
      continue;
    }

    // Chapter number/title/strapline are handled by the preserved Shopify chapter header.
    applyOrderedCopy(section, copy.slice(3));
  }

  const footer = findFooter(document);
  if (footer) applyOrderedCopy(footer, footerCopy);

  replaceBrandResidue(document);
  return serialize(document);
}
