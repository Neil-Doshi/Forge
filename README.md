# HTML Forge

HTML Forge is a local-first browser tool for importing existing HTML, converting it into an editable GrapesJS workspace, repairing navigation/overlay behavior, saving reusable local components, and exporting safe standalone prototypes.

The repository contains the tool only. Imported source files, editable projects, libraries, reports, assets, and exports remain in the user browser or download folder unless the user intentionally commits or uploads them elsewhere.

## What It Does

- Creates blank local projects and imports untrusted HTML through an inert analyzer.
- Keeps source analysis, safe visual preview, and approved behavior preview in separate surfaces.
- Sanitizes HTML, quarantines scripts/handlers, strips editor-spoofing metadata, and neutralizes network-bearing CSS.
- Integrates `grapesjs@0.23.2` with telemetry disabled and app-owned IndexedDB storage.
- Detects screens, overlays, CSS tokens, keyframes, interaction candidates, missing targets, and reusable component candidates.
- Provides dedicated Home, Editor, Connections, Library, Report, Export, and Settings workspaces.
- Exports portable `.htmlforge.zip` backups, editable JSON when safe, import reports, AI handoff bundles, and standalone HTML prototypes with only approved runtime behavior.

## Local Development

```powershell
npm install
npm run dev
```

Production verification:

```powershell
npm test
npm run build
npm run preview
```

The app is static and deployable to GitHub Pages. `vite.config.ts` sets the `/Forge/` base path used by the public repository deployment.

## Privacy And Safety

HTML Forge has no backend, no cloud project save, no analytics, and no runtime CDN scripts. Browser persistence uses IndexedDB and optionally `navigator.storage.persist()`; it is durable local storage, not a guaranteed backup. Export portable project backups before clearing browser data or moving machines.

Imported scripts are never executed in analysis, preview, editor canvas, or default export. Imported remote resources are blocked by default and listed in the import report for batch decisions.

## Licenses

Dependency decisions and license notices are tracked in `DEPENDENCY_REGISTER.md` and `THIRD_PARTY_NOTICES.md`.
