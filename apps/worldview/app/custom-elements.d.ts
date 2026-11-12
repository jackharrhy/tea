export type MapsViewAttributes = {
  controls?: "walk" | "fly";
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "tea-map-view": MapsViewAttributes;
    }
  }
}
