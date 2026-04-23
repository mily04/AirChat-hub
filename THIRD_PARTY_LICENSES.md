# Third-Party License Review

This file summarizes a dependency license review for Tmesh based on the current `package-lock.json`.

Review date: 2026-04-22

## Project License

Tmesh itself is licensed under GNU Affero General Public License version 3 or later (AGPL-3.0-or-later), with a separate commercial licensing path available from the project maintainer.

## Technology Scope

The reviewed dependency set belongs to the TypeScript / React / Vite / Express / Socket.IO application defined by `package.json` and `package-lock.json`.

## Summary

No dependency license was found that is obviously incompatible with distributing Tmesh under AGPL-3.0-or-later.

The dependency tree contains common permissive licenses such as MIT, ISC, BSD, 0BSD, and Apache-2.0. Apache-2.0 is generally compatible with GPLv3-family licensing. The dependency tree also contains MPL-2.0 packages from `lightningcss`; MPL-2.0 is a file-level weak copyleft license and should be preserved for those third-party files. `caniuse-lite` is licensed under CC-BY-4.0 and should retain attribution notices when redistributed.

This review is an engineering compliance note, not legal advice.

## License Counts

| License | Package count |
| --- | ---: |
| MIT | 401 |
| ISC | 22 |
| MPL-2.0 | 12 |
| Apache-2.0 | 4 |
| BSD-3-Clause | 3 |
| BSD-2-Clause | 2 |
| BSD-2-Clause OR MIT OR Apache-2.0 | 1 |
| MIT OR WTFPL | 1 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |

## Non-Permissive or Attribution-Sensitive Packages

| Package | Version | License | Note |
| --- | --- | --- | --- |
| `lightningcss` | 1.32.0 | MPL-2.0 | File-level weak copyleft; keep upstream notices and license terms for this dependency. |
| `lightningcss-*` platform packages | 1.32.0 | MPL-2.0 | Optional/native platform packages used by `lightningcss`; keep upstream notices and license terms. |
| `caniuse-lite` | 1.0.30001788 | CC-BY-4.0 | Attribution-oriented data package; keep upstream attribution notices when redistributing dependency artifacts. |
| `expand-template` | 2.0.3 | MIT OR WTFPL | Dual-licensed permissive package pulled in by packaging tooling. |
| `rc` | 1.2.8 | BSD-2-Clause OR MIT OR Apache-2.0 | Multi-licensed permissive package pulled in by packaging tooling. |

## Direct Dependencies

| Package | Declared role | License family |
| --- | --- | --- |
| `@tailwindcss/vite` | build tooling | MIT |
| `@vitejs/plugin-react` | build tooling | MIT |
| `bonjour-service` | LAN discovery | MIT |
| `clsx` | UI utility | MIT |
| `dotenv` | environment loading | BSD-2-Clause |
| `express` | HTTP server | MIT |
| `lucide-react` | icons | ISC |
| `motion` | UI motion library | MIT |
| `multer` | file upload handling | MIT |
| `react` | UI framework | MIT |
| `react-dom` | UI rendering | MIT |
| `socket.io` | realtime server | MIT |
| `socket.io-client` | realtime client | MIT |
| `tailwind-merge` | Tailwind class utility | MIT |
| `tailwindcss` | styling toolchain | MIT |
| `vite` | development/build tooling | MIT |
| `pkg` | executable packaging toolchain | MIT |

## Maintenance Notes

Run this review again after dependency upgrades, especially before publishing packaged binaries or commercial builds.

Recommended checks:

```bash
npm install
npm run lint
npm run build
```

If a future dependency introduces GPL, AGPL, SSPL, BUSL, a custom commercial license, or a package with missing/unclear license metadata, review it before release.
