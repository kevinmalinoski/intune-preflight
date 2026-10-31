import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The same index.html backs three builds: the self-hosted bundle, the public
// demo at /intune-preflight/demo/ and the browser app at /intune-preflight/app/.
// Only the last two are ever linked to from anywhere public, so only those two
// get social-card markup -- and they get it keyed off the base path they were
// built for, because og:url and canonical have to be absolute and a card that
// names the wrong URL is worse than no card.
//
// A self-hosted build deliberately gets nothing. It is served from someone
// else's private network, where pointing og:url at this GitHub Pages site would
// be a lie, and where nobody is unfurling the link anyway.
const SITE = "https://kevinmalinoski.github.io";

const OG_IMAGE_ALT =
  "The Intune Preflight simulator: a configured endpoint resolving through Autopilot and Entra groups to the policies that apply to it.";

const PUBLIC_PAGES: Record<string, { title: string; description: string }> = {
  "/intune-preflight/app/": {
    title: "Intune Preflight — simulate an Intune endpoint before you deploy",
    description:
      "Simulate an Intune endpoint and see the exact merged CSP baseline it would receive — conflicts, overlaps, Autopilot and assignment filters included. Read-only, runs in your browser, no install.",
  },
  "/intune-preflight/demo/": {
    title: "Intune Preflight — live demo, no sign-in required",
    description:
      "Try Intune Preflight against a bundled sample tenant: no sign-in, no tenant, nothing to set up. Simulate an endpoint and see the merged policy baseline, conflicts and overlaps it would receive.",
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// og-card.png ships in public/, so it lands at the root of whichever base the
// bundle was built for and needs no separate deploy step.
function socialCards(): Plugin {
  let base = "/";
  return {
    name: "preflight-social-cards",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml(html) {
      const page = PUBLIC_PAGES[base];
      if (!page) return html;

      const url = SITE + base;
      const image = url + "og-card.png";
      const title = esc(page.title);
      const description = esc(page.description);

      // Replace rather than append: a second <title> or description is ignored
      // by some scrapers and preferred by others, so leaving both is a coin flip.
      const rewritten = html
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
        .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="${description}" />`);

      return {
        html: rewritten,
        tags: [
          { tag: "link", attrs: { rel: "canonical", href: url }, injectTo: "head" as const },
          ...Object.entries({
            "og:type": "website",
            "og:site_name": "Intune Preflight",
            "og:url": url,
            "og:title": page.title,
            "og:description": page.description,
            "og:image": image,
            "og:image:type": "image/png",
            "og:image:width": "1200",
            "og:image:height": "630",
            "og:image:alt": OG_IMAGE_ALT,
          }).map(([property, content]) => ({
            tag: "meta",
            attrs: { property, content },
            injectTo: "head" as const,
          })),
          ...Object.entries({
            "twitter:card": "summary_large_image",
            "twitter:title": page.title,
            "twitter:description": page.description,
            "twitter:image": image,
            "twitter:image:alt": OG_IMAGE_ALT,
          }).map(([name, content]) => ({
            tag: "meta",
            attrs: { name, content },
            injectTo: "head" as const,
          })),
        ],
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), socialCards()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
