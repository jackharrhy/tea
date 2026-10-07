export type WorldViewAttributes = {
  controls?: "walk" | "fly";
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "world-view": WorldViewAttributes;
    }
  }
}
