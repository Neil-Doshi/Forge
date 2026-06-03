# Dependency Register

HTML Forge bundles approved runtime dependencies locally. No runtime script is loaded from a CDN.

| Package | Version | Role | License | Notes |
|---|---:|---|---|---|
| `grapesjs` | `0.23.2` | Visual editor engine | BSD-3-Clause | Telemetry disabled in initialization; storage manager disabled. |
| `dompurify` | `3.4.8` | HTML sanitization baseline | Apache-2.0 OR MPL-2.0 | Wrapped by HTML Forge validation and reporting. |
| `idb` | `8.0.2` | IndexedDB helper | ISC | Local-only persistence adapter. |
| `fflate` | `0.8.2` | ZIP backup/export helper | MIT | Generates portable local project packages. |
| `vite` | `6.4.3` | Build tool | MIT | Static GitHub Pages build. |
| `typescript` | `5.8.3` | Type checking | Apache-2.0 | Development-only. |
| `vitest` | `4.1.8` | Automated tests | MIT | Development-only. |
| `jsdom` | `26.1.0` | DOM test environment | MIT | Development-only. |
| `fake-indexeddb` | `6.0.0` | IndexedDB test shim | Apache-2.0 | Development-only. |

Dependency updates require retesting import sanitization, GrapesJS initialization, storage round trips, export safety, and bundle size.
