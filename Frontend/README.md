# AstroVital — Astronaut Health & Wellbeing Companion

Frontend starter for the AstroVital NASA Space Apps project. Visual direction: deep-space navy, violet/purple glow, cyan telemetry accents, subtle starfield and responsive mission-control layout.

## Included in this ZIP

- Vite + React 18 + TypeScript.
- React Router v6 with all 12 requested sidebar routes.
- Zustand state stores and React Query provider.
- Axios client and separated API service modules.
- Tailwind CSS, Framer Motion, Recharts and Lucide React.
- Overview dashboard with charts and clearly marked demo data.
- Distinct workspaces for all remaining modules; Daily Check-in has local-only interactive sliders and Bone & Muscle includes an interactive illustrative body-region selector.
- Requested folder groups including `StarfieldBackground.tsx`, `theme.css`, `animations.css`, API type-generation command, tests and environment example.

## Run on Windows (PowerShell, CMD or Git Bash)

1. Install Node.js 18 or newer (Node.js 20 LTS recommended).
2. Extract this ZIP.
3. Open the extracted `astronova-frontend` folder in VS Code.
4. Open a terminal in that folder and run:

```bash
npm install
npm run dev
```

5. Open the local URL printed by Vite, normally `http://localhost:5173`.

No `.env` file is required to view the frontend in demo mode. If you want to configure it, copy `.env.example` to `.env` and keep `VITE_USE_MOCKS=true` until API integration is ready.

## Build and tests

```bash
npm run build
npm test
```

Generate frontend API types from the running FastAPI backend:

```bash
npm run generate:api
```

The backend must be running at the URL in `VITE_API_BASE_URL` for type generation.

## Backend integration notes (from the supplied Backend ZIP)

The backend is FastAPI and its default API prefix is `/api/v1`. Its CORS defaults currently allow ports 3000, so add these Vite development origins in backend `.env` before browser-to-backend integration:

```env
CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173"]
```

Routes confirmed in the supplied backend include:
- `GET /health`
- `GET/POST /astronauts`, `GET/PUT /astronauts/{astronaut_id}`
- `GET /dashboard/{astronaut_id}/overview`
- `GET /dashboard/{astronaut_id}/trends?days=30`
- `POST /observations`, `POST /observations/bulk`, `GET /observations/{astronaut_id}`, `GET /observations/{astronaut_id}/latest`
- `POST /wellbeing/assessment`, `GET /wellbeing/{astronaut_id}`, `GET /wellbeing/{astronaut_id}/trends`
- `GET /risk/{astronaut_id}`, `POST /risk/analyze/{astronaut_id}`, `GET /risk/{astronaut_id}/history`
- `GET /alerts/{astronaut_id}`, `POST /alerts/{alert_id}/acknowledge`
- `POST /recommendations/evaluate`, `GET /recommendations/protocols`, `GET /recommendations/{astronaut_id}`
- `GET /body-map/regions`, `POST /body-map/symptoms`, `GET /body-map/{astronaut_id}`, `GET /body-map/{astronaut_id}/trends`
- `GET /sync/status`, `POST /sync/push`, `POST /sync/conflicts/{conflict_id}/resolve`

The current backend ZIP contains rule-based risk assessment and protocol-based recommendations. It does not yet expose a confirmed trained-ML inference endpoint, so ML predictions are not represented as live in this frontend.

## Important demo/data notes

- `VITE_USE_MOCKS=true` is the safe default.
- Overview sample values, module metric cards, body-map selection and check-in interaction are illustrative UI data only.
- Daily Check-in currently updates local component state only; it does not persist or call the API yet.
- Medical View is a layout preview only; implement authentication, role-based authorization and privacy controls before using real crew data.
- Do not use demo values for medical decisions. This is a decision-support prototype, not a validated medical device.

## Structure

Feature folders mirror the 12 sidebar sections. Services are kept separate from components so the frontend can move from mock data to real API responses without rewriting the page layout.
