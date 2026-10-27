import type { P5Child, P5Document, P5Element } from "./treeTypes.js";
import { isElementNode } from "./ignoreRules.js";

/**
 * Extract a likely React component name from the DOM context around a mismatch.
 *
 * Walks up the parse5 tree from the mismatch node through ancestors, looking
 * for identifiable markers in this priority order:
 *   1. data-module attribute
 *   2. data-component attribute
 *   3. data-testid attribute
 *   4. id attribute matching a known component mapping
 *   5. className matching a known component pattern
 */

function attrVal(el: P5Element, name: string): string | undefined {
  return el.attrs?.find((a) => a.name === name)?.value;
}

/** ShikshaPWA-specific id/class → component+file mapping */
export interface ComponentEntry {
  component: string;
  file: string;
}

/**
 * Known ShikshaPWA DOM identifiers → React component/file.
 * Curated from application source analysis.
 */
export const SHIKSHA_COMPONENT_MAP: Record<string, ComponentEntry> = {
  // ─── Layout / App shell ───
  "main-wrapper": { component: "App (Desktop)", file: "application/App/App.js" },
  "content-main-wrapper": { component: "App (Mobile)", file: "application/App/App.js" },
  root: { component: "Root", file: "application/client/index.js" },

  // ─── Header / Footer ───
  "mobile_header": { component: "HeaderMobile", file: "application/modules/common/components/Header" },
  "desktop_header": { component: "Header (Desktop)", file: "application/modules/common/components/desktop/Header" },
  "mobile_footer": { component: "FooterMobile", file: "application/modules/common/components/FooterTemplate" },
  "desktop_footer": { component: "Footer (Desktop)", file: "application/modules/common/components/desktop/Footer" },

  // ─── Listing / Institute page ───
  "highlights-section": { component: "HighlightsComponent", file: "application/modules/listing/InstitutePage/Components/HighlightsComponent.tsx" },
  "placement-section": { component: "PlacementComponent", file: "application/modules/listing/InstitutePage/Components/PlacementComponent.tsx" },
  "overall-review-section": { component: "OverAllReviewCard", file: "application/modules/listing/InstitutePage/Components/OverAllReviewCard.tsx" },
  "admission-dates-section": { component: "UILPAdmissionDates", file: "application/modules/listing/InstitutePage/Components/UILPAdmissionDates.tsx" },
  "student-profile-section": { component: "StudentProfile", file: "application/modules/listing/InstitutePage/Components/StudentProfile.tsx" },
  "college-list-section": { component: "CollegeListComponent", file: "application/modules/listing/InstitutePage/Components/CollegeListComponent.tsx" },
  "bac-courses-section": { component: "BacWiseCourses", file: "application/modules/listing/InstitutePage/Components/BacWiseCourses.tsx" },
  "webinar-widget": { component: "WebinarWidget", file: "application/modules/listing/InstitutePage/Components/WebinarWidget.tsx" },
  "domestic-scholarship": { component: "DomesticScholarship", file: "application/modules/listing/InstitutePage/Components/DomesticScholarship.tsx" },
  "admission-process-section": { component: "AdmissionProcess", file: "application/modules/listing/instituteChildPages/components/AdmissionProcess.tsx" },

  // ─── Exam page ───
  "exam-page-main": { component: "ExamPageMain", file: "application/modules/examPage/components/ExamPageMain.js" },
  "exam-page-desktop": { component: "ExamPageDesktop", file: "application/modules/examPage/components/ExamPageDesktop.js" },
  "exam-bottom-sticky": { component: "ExamBottomSticky", file: "application/modules/examPage/components/ExamBottomSticky.js" },

  // ─── Search / Category ───
  "category-page": { component: "CategoryPage (V3)", file: "application/modules/search/V3/Layout/Category.tsx" },
  "search-result": { component: "SearchResult (V3)", file: "application/modules/search/V3/Layout/SearchResult.tsx" },

  // ─── ShikshaGPT ───
  "ai-overview": { component: "AIOverview", file: "application/modules/shikshaGPT/components/AIOverview.tsx" },
  "shiksha-gpt-widget": { component: "ShikshaGPTSearchWidget", file: "application/modules/shikshaGPT/components/ShikshaGPTSearchWidget.tsx" },

  // ─── Counselling ───
  "counselling-assistance": { component: "CounsellingAssistanceWrapper", file: "application/modules/search/V3/modules/CategoryPage/widget/CounsellingAssistanceWrapper.tsx" },
  "user-feedback-widget": { component: "UserFeedback", file: "application/modules/search/V3/modules/CategoryPage/widget/UserFeedback.tsx" },
};

/** Class-name patterns that hint at component boundaries (substring match) */
const CLASS_COMPONENT_PATTERNS: Array<{ pattern: string; component: string; file?: string }> = [
  { pattern: "placementSection", component: "PlacementComponent", file: "application/modules/listing/InstitutePage/Components/PlacementComponent.tsx" },
  { pattern: "highlightsSection", component: "HighlightsComponent", file: "application/modules/listing/InstitutePage/Components/HighlightsComponent.tsx" },
  { pattern: "overallReviewCard", component: "OverAllReviewCard", file: "application/modules/listing/InstitutePage/Components/OverAllReviewCard.tsx" },
  { pattern: "admissionDates", component: "UILPAdmissionDates", file: "application/modules/listing/InstitutePage/Components/UILPAdmissionDates.tsx" },
  { pattern: "studentProfile", component: "StudentProfile", file: "application/modules/listing/InstitutePage/Components/StudentProfile.tsx" },
  { pattern: "pwa_wrapper", component: "App (Desktop)", file: "application/App/App.js" },
  { pattern: "content-main-wrapper", component: "App", file: "application/App/App.js" },
  { pattern: "counselling", component: "CounsellingWidget" },
  { pattern: "webinar", component: "WebinarWidget" },
  { pattern: "exam-page", component: "ExamPage" },
  { pattern: "searchResult", component: "SearchResult" },
  { pattern: "categoryPage", component: "CategoryPage" },
  { pattern: "inlineReg", component: "InlineRegistration" },
  { pattern: "shortlist", component: "ShortlistWidget" },
];

export interface ComponentHintResult {
  componentHint?: string;
  sourceFile?: string;
}

function getDocumentElement(doc: P5Document): P5Element | null {
  for (const c of doc.childNodes ?? []) {
    if (isElementNode(c) && c.tagName === "html") return c;
  }
  return null;
}

function elementChildren(el: P5Element): P5Element[] {
  return (el.childNodes ?? []).filter(isElementNode) as P5Element[];
}

/**
 * Parse the diff path and walk the tree to collect the ancestor chain.
 */
function collectAncestorChain(doc: P5Document, diffPath: string): P5Element[] {
  const parts = diffPath.split(/\s*>\s*/);
  let current = getDocumentElement(doc);
  if (!current) return [];

  const chain: P5Element[] = [current];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]!;
    const textMatch = /^#text/.test(p);
    if (textMatch) break;

    const idxMatch = /^(\S+?)(?:\[(\d+)\]|@\[(\d+)\])$/.exec(p);
    const tag = idxMatch ? idxMatch[1]! : p;
    const idx = idxMatch ? Number(idxMatch[2] ?? idxMatch[3] ?? 0) : 0;

    const children = elementChildren(current);
    const sameTag = children.filter((c) => c.tagName === tag);
    const child = sameTag[idx] ?? children[idx];
    if (!child) break;
    chain.push(child);
    current = child;
  }
  return chain;
}

/**
 * Try to identify a React component from a single element.
 */
function identifyFromElement(
  el: P5Element,
  componentMap: Record<string, ComponentEntry>
): ComponentHintResult | null {
  // 1. data-module
  const mod = attrVal(el, "data-module");
  if (mod) {
    const mapped = componentMap[mod];
    return {
      componentHint: mapped?.component ?? mod,
      sourceFile: mapped?.file,
    };
  }

  // 2. data-component
  const comp = attrVal(el, "data-component");
  if (comp) {
    const mapped = componentMap[comp];
    return {
      componentHint: mapped?.component ?? comp,
      sourceFile: mapped?.file,
    };
  }

  // 3. data-testid
  const testId = attrVal(el, "data-testid");
  if (testId) {
    const mapped = componentMap[testId];
    if (mapped) return { componentHint: mapped.component, sourceFile: mapped.file };
    // Convert data-testid to a component-like name
    const hint = testId
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\s+/g, "");
    return { componentHint: hint };
  }

  // 4. id
  const id = attrVal(el, "id");
  if (id) {
    const mapped = componentMap[id];
    if (mapped) return { componentHint: mapped.component, sourceFile: mapped.file };
  }

  // 5. class patterns
  const cls = attrVal(el, "class") ?? "";
  for (const { pattern, component, file } of CLASS_COMPONENT_PATTERNS) {
    if (cls.includes(pattern)) {
      return { componentHint: component, sourceFile: file };
    }
  }

  return null;
}

/**
 * Walk ancestors from mismatch node upward to find the nearest component boundary.
 */
export function extractComponentHint(
  doc: P5Document,
  diffPath: string,
  componentMap: Record<string, ComponentEntry> = SHIKSHA_COMPONENT_MAP
): ComponentHintResult {
  const chain = collectAncestorChain(doc, diffPath);
  if (chain.length === 0) return {};

  // Walk bottom-up (closest ancestor first)
  for (let i = chain.length - 1; i >= 0; i--) {
    const result = identifyFromElement(chain[i]!, componentMap);
    if (result) return result;
  }

  return {};
}
