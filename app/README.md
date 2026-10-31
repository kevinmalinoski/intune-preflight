# Static files served at the base of every build

Vite copies this directory to the root of each bundle, so a file here lands
next to `index.html` whatever base the build was given — which is why the
social card lives here and not in `docs/img/`: `/app/` and `/demo/` are
published from the same source and each needs the image at its own URL.

| File | What it is |
|---|---|
| `og-card.png` | 1200×630 Open Graph / Twitter card, referenced by the tags that `vite.config.ts` injects into the public builds. Regenerate with `python3 scripts/make-og-card.py`. |

Keep `og-card.png` **under ~300 KB** and at **exactly 1200×630**. Both are load-bearing: LinkedIn silently drops oversized images, and scrapers crop anything that isn't 1.91:1.

After changing it, re-unfurl the URLs so the platforms drop their cached copy —
[Facebook's debugger](https://developers.facebook.com/tools/debug/),
[LinkedIn's Post Inspector](https://www.linkedin.com/post-inspector/). Caches
last days to weeks, so this is worth doing the same day.
