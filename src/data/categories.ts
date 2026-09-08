export interface CategoryMeta {
  id: string;
  numeral: string;
  name: string;
}

export const categories: CategoryMeta[] = [
  { id: "sidekick", numeral: "I", name: "Method" },
  { id: "agentic", numeral: "II", name: "Path" },
  { id: "online", numeral: "III", name: "Courses" },
  { id: "retail", numeral: "IV", name: "Practice" },
  { id: "marketing", numeral: "V", name: "Feedback" },
  { id: "checkout", numeral: "VI", name: "Revision" },
  { id: "operations", numeral: "VII", name: "Finish" },
  { id: "shop-app", numeral: "VIII", name: "Prompts" },
  { id: "b2b", numeral: "IX", name: "Archive" },
  { id: "finance", numeral: "X", name: "Support" },
  { id: "shipping", numeral: "XI", name: "Proof" },
  { id: "developer", numeral: "XII", name: "Questions" },
];
