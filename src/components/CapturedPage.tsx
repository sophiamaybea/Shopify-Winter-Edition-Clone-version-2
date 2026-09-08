import { readFileSync } from "node:fs";
import path from "node:path";
import { applyBeaCopy } from "@/lib/apply-bea-copy";

const capturedPageHtml = applyBeaCopy(
  readFileSync(
    path.join(process.cwd(), "src/data/captured-page.html"),
    "utf8"
  )
);

/**
 * The editorial page is rendered from the captured, post-hydration source DOM.
 * This preserves the original component hierarchy, product markup, labels, and
 * drawing primitives instead of translating 200 products by hand.
 */
export function CapturedPage() {
  return (
    <div
      id="captured-page"
      className="contents"
      dangerouslySetInnerHTML={{ __html: capturedPageHtml }}
    />
  );
}
