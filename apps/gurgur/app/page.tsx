import { GurgurWorld } from "./world";
import { documentStyles } from "./styles";

export function GurgurPage() {
  return () => (
    <html lang="en" mix={documentStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <title>Gurgur · Tea</title>
      </head>
      <body>
        <GurgurWorld />
        <script type="module" src="/assets/game.js" />
      </body>
    </html>
  );
}
