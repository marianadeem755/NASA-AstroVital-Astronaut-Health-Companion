# Update notes — frontend review build

## Fixed / updated files
- `package.json`: corrected build command to `tsc --noEmit && vite build`; added OpenAPI type generation script and `openapi-typescript`.
- `vite.config.ts`: added Vitest environment and setup configuration.
- `tsconfig.json` + `src/vite-env.d.ts`: added Vite client typings for `import.meta.env`.
- `src/app/router/index.tsx`: rebuilt route rendering to avoid invalid index-route/path combinations.
- `src/app/router/routes.config.ts`: explicit map for all 12 routes.
- `src/app/layouts/MainLayout.tsx`: added dedicated starfield background component.
- `src/app/layouts/StarfieldBackground.tsx`: added missing background component.
- `src/app/layouts/Sidebar.tsx`: improved mobile drawer behaviour, accessible labels and navigation close behaviour.
- `src/app/layouts/Topbar.tsx`: active-page breadcrumb, working search toggle and alerts navigation.
- `src/modules/*/pages/*.tsx`: added an actual page entry component for every sidebar feature.
- `src/shared/components/ModulePage.tsx`: replaced generic blank placeholder with domain-specific workspace content; added local check-in controls and an illustrative selectable body map.
- `src/services/http/endpoints.ts`: corrected endpoint catalogue against the supplied FastAPI backend.
- `src/services/observations.service.ts`: fixed create-observation POST URL and added latest/bulk methods.
- `src/services/astronauts.service.ts`: added create/update methods and consistent endpoint usage.
- `src/services/alerts.service.ts`: aligned acknowledgement payload with backend schema.
- `src/services/wellbeing.service.ts`: added wellbeing trends endpoint.
- `src/services/countermeasures.service.ts`, `src/services/sync.service.ts`: aligned service calls to backend route catalogue.
- `src/styles/globals.css`: added responsive drawer, check-in and body-map styles.
- `src/styles/theme.css`, `src/styles/animations.css`: added the requested split theme/animation files.
- `START_FRONTEND.bat`: added a Windows-friendly startup helper.
- `README.md`, `.env.example`: clarified startup, mock mode, backend CORS and integration steps.
- `src/types/api.d.ts`: added OpenAPI type-generation entry point.
- `UPDATE_NOTES.md`: this change log.

## Verification limitation
Static checks were performed on archive contents, page coverage and relative imports. A full `npm install` / `npm run build` could not be completed in the packaging environment because dependency installation timed out. Run `npm install`, `npm run build` and `npm test` locally after extracting the ZIP.


## Runtime hotfix (latest upload)
- `src/modules/overview/pages/OverviewPage.tsx`: imported the referenced `ShieldCheck` Lucide icon; this fixes the `ReferenceError: ShieldCheck is not defined` crash reported in the browser console.
- `index.html`: explicitly links `public/favicon.svg` to avoid the browser falling back to `/favicon.ico`.
