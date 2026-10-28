import type { MetadataRoute } from "next";

// The web app manifest, which is what makes the app installable: the browser
// uses it to build the home-screen icon, the splash screen and the title of
// the installed app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Teaching Manager",
    short_name: "Teaching",
    description: "Manage classes, students and monthly tuition payments",
    // The app is a single page, so it always starts at the root.
    start_url: "/",
    scope: "/",
    // "standalone" removes the browser chrome, so the app looks native.
    display: "standalone",
    orientation: "any",
    // Matches the indigo header gradient of the app.
    theme_color: "#4f46e5",
    background_color: "#f1f5f9",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // The maskable icon keeps the artwork inside the safe zone, so the
        // platform can crop it to any shape without clipping the glyph.
        src: "/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
