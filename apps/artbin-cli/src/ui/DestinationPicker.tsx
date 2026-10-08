import React from "react";

export function DestinationPicker({
  folders,
  value,
  onChange,
}: {
  folders: { slug: string; id: string }[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const root = value.split("/")[0];
  const roots = folders.filter((folder) => !folder.slug.includes("/"));
  const children = folders.filter(
    (folder) =>
      folder.slug.startsWith(`${root}/`) && folder.slug.split("/").length === 2,
  );
  return (
    <>
      <label
        className="block text-sm mb-1 font-semibold"
        htmlFor="destination-root"
      >
        Top-level folder
      </label>
      <select
        id="destination-root"
        className="w-full p-2 border border-border-light bg-white text-sm mb-3"
        value={roots.some((folder) => folder.slug === root) ? root : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">New top-level folder…</option>
        {roots.map((folder) => (
          <option key={folder.id} value={folder.slug}>
            {folder.slug}
          </option>
        ))}
      </select>
      {root && roots.some((folder) => folder.slug === root) && (
        <>
          <label
            className="block text-sm mb-1 font-semibold"
            htmlFor="destination-folder"
          >
            Destination folder
          </label>
          <select
            id="destination-folder"
            className="w-full p-2 border border-border-light bg-white text-sm mb-3"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value={root}>{root} (this folder)</option>
            {children.map((folder) => (
              <option key={folder.id} value={folder.slug}>
                {folder.slug}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );
}
