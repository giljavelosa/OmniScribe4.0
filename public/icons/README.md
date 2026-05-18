# OmniScribe PWA Icons

The manifest at `/manifest.json` references:

- `/icons/icon-192.png` — 192×192 PNG (any purpose)
- `/icons/icon-512.png` — 512×512 PNG (any + maskable)

Generate these from the brand quill SVG in `src/components/brand-wordmark.tsx`
(or supply a designer-produced PNG). Both files should:

- Sit on a `#3d8b8b` theme-colored background OR a transparent canvas
  (browsers paint the manifest `background_color` underneath).
- Include enough padding for the maskable safe area (40% center).

These files are NOT generated automatically — drop the binaries in
this directory before deploying to production. Until then, browsers
will fall back to a default favicon icon when the manifest is loaded,
which is acceptable for dev + staging.
