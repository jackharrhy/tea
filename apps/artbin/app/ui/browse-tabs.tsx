import { type Handle } from "remix/component";

import { Tabs } from "./navigation.tsx";

export type ViewMode =
  | "folders"
  | "textures"
  | "models"
  | "maps"
  | "sounds"
  | "all";

interface BrowseTabsProps {
  baseUrl: string;
  currentView: ViewMode;
  counts: Partial<Record<ViewMode, number>>;
}

const tabs: { id: ViewMode; label: string }[] = [
  { id: "folders", label: "Folders" },
  { id: "textures", label: "Textures" },
  { id: "models", label: "Models" },
  { id: "maps", label: "Maps" },
  { id: "sounds", label: "Sounds" },
  { id: "all", label: "All files" },
];

export function BrowseTabs(handle: Handle<BrowseTabsProps>) {
  return () => {
    const { baseUrl, currentView, counts } = handle.props;
    return (
      <Tabs
        label="Browse by type"
        activeId={currentView}
        items={tabs.map((tab) => ({
          ...tab,
          href: tab.id === "folders" ? baseUrl : `${baseUrl}?view=${tab.id}`,
          count: counts[tab.id],
        }))}
      />
    );
  };
}
