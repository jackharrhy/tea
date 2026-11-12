// Geometry glyphs from the original Worldview editor.
const box = <path d="M4 7 15 4 21 9 10 12 4 7v11l6 3 11-4V9M10 12v9" />;
const square = <path d="M5 5h14v14H5z" />;

export type GeometryTool =
  | "select"
  | "entity"
  | "hull"
  | "face"
  | "sweep"
  | "clip"
  | "vertex"
  | "edge"
  | "rotate"
  | "scale"
  | "shear"
  | "create";

export function editorGeometryIcon(name: GeometryTool) {
  const glyph = {
    select: (
      <>
        {box}
        <path
          class="geometry-accent"
          fill="currentColor"
          fillOpacity=".2"
          d="m3 3 8 3-4 2-1 4z"
        />
      </>
    ),
    entity: (
      <>
        {box}
        <path class="geometry-accent" d="M13 10v7m-3-3h6" />
      </>
    ),
    hull: (
      <>
        <path d="m4 8 9-4 7 7-5 9-11-3Z" />
        <g class="geometry-accent" fill="currentColor" stroke="none">
          <circle cx="4" cy="8" r="1.5" />
          <circle cx="13" cy="4" r="1.5" />
          <circle cx="20" cy="11" r="1.5" />
          <circle cx="15" cy="20" r="1.5" />
          <circle cx="4" cy="17" r="1.5" />
        </g>
      </>
    ),
    face: (
      <>
        {box}
        <path
          class="geometry-accent"
          fill="currentColor"
          fillOpacity=".25"
          d="m10 12 11-3v8l-11 4z"
        />
      </>
    ),
    sweep: (
      <>
        <path d="M4 12h9v9H4zM10 3h9v9M13 12l6-9M4 12l6-9" />
        <path class="geometry-accent" d="m15 17 6-6m-5 0h5v5" />
      </>
    ),
    clip: (
      <>
        {box}
        <path
          class="geometry-accent"
          strokeWidth="2"
          d="m14 2-6 20m3-17 3-3 1 4M5 18l3 4 3-3"
        />
      </>
    ),
    vertex: (
      <>
        {square}
        <g class="geometry-accent" fill="currentColor" stroke="none">
          <circle cx="5" cy="5" r="1.5" />
          <circle cx="19" cy="5" r="1.5" />
          <circle cx="19" cy="19" r="1.5" />
          <circle cx="5" cy="19" r="1.5" />
        </g>
      </>
    ),
    edge: (
      <>
        {square}
        <path class="geometry-accent" strokeWidth="2" d="M5 5h14" />
        <g class="geometry-accent" fill="currentColor">
          <circle cx="5" cy="5" r="1.5" />
          <circle cx="19" cy="5" r="1.5" />
        </g>
      </>
    ),
    rotate: (
      <>
        <path d="m8 9 8-2 2 8-8 2Z" />
        <path class="geometry-accent" d="M5 17a9 9 0 1 1 15-2m-1-5 1 5 3-3" />
      </>
    ),
    scale: (
      <>
        {square}
        <path class="geometry-accent" d="m8 16 12-12m-5 0h5v5" />
        <path class="geometry-accent" fill="currentColor" d="M3 17h4v4H3z" />
      </>
    ),
    shear: (
      <>
        <path d="M5 5h12v14H5z" strokeDasharray="2 2" />
        <path class="geometry-accent" d="M10 5h11l-7 14H3z" />
      </>
    ),
    create: (
      <>
        {box}
        <path class="geometry-accent" d="M12 5v7m-3-3h6" />
      </>
    ),
  }[name];

  return (
    <svg
      class="geometry-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
