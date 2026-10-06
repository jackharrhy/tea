import { css } from "remix/component";

export const risoStyles = css({
  "& .riso-colors": {
    display: "flex",
    "flex-wrap": "wrap",
    gap: "0.5rem",
  },
  "& .riso-colors button": {
    width: "7.5rem",
    height: "7.5rem",
    border: "1px solid #0002",
    "border-radius": "50%",
    padding: "0.75rem",
    color: "#fff",
    "text-shadow": "0 1px 4px #000a",
    cursor: "pointer",
    transition: "transform 0.15s",
  },
  "& .riso-colors button:hover": {
    transform: "scale(1.05)",
  },
});
