# Static files served at the base of every build

Vite copies this directory to the root of each bundle, so a file here lands
next to `index.html` whatever base the build was given — which is why the
social card lives here and not in `docs/img/`: `/app/` and `/demo/` are
published from the same source and each needs the image at its own URL.

| File | What it is |
|---|---|
| `og-card.png` | 2400×1260 Open Graph / Twitter card, referenced by the tags that `vite.config.ts` injects into the public builds. Regenerate with `python3 scripts/make-og-card.py` (optional second arg is the scale; 2 is the default and gives 2400×1260). |

Keep `og-card.png` at **1.91:1** and **at least 1200×630**, which is LinkedIn's documented floor for the large-card layout — we ship 2× that so we are never sitting on the threshold. Stay well under LinkedIn's 5 MB ceiling. If you change the size, change `og:image:width`/`height` in `vite.config.ts` to match: some scrapers trust the tags over the bytes, so a card that under-declares itself gets laid out small.

After changing it, re-unfurl the URLs so the platforms drop their cached copy —
[Facebook's debugger](https://developers.facebook.com/tools/debug/),
[LinkedIn's Post Inspector](https://www.linkedin.com/post-inspector/). Caches
last days to weeks, so this is worth doing the same day.
