import navigation from "@/config/navigation.json";
import catalog from "@/config/source-catalog.json";
export type Collection = {
  categoryId: string;
  categoryLabel: string;
  tabId: string;
  tabLabel: string;
};
export function defaultCollections(sourceId: string): Collection[] {
  const route = catalog.sources.find((s) => s.id === sourceId)?.defaultRoute;
  if (!route) return [];
  const category = navigation.find((c) => c.id === route.categoryId);
  if (!category) return [];
  const tab = category.tabs.find((t) => t.id === route.tabId);
  return [
    {
      categoryId: category.id,
      categoryLabel: category.label,
      tabId: tab?.id ?? "all",
      tabLabel: tab?.label ?? "All reading",
    },
  ];
}
export function validCollection(c: Collection) {
  const category = navigation.find((n) => n.id === c.categoryId);
  if (!category || category.label !== c.categoryLabel) return false;
  if (c.tabId === "all") return c.tabLabel === "All reading";
  return category.tabs.some((t) => t.id === c.tabId && t.label === c.tabLabel);
}
