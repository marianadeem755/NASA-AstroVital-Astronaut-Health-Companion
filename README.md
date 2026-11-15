# AstroVital: Personalized Astronaut Health Monitoring & Risk Detection System

*NASA Space Apps 2026 · Team AstroNova Stellers*

## Problem Statement

An astronaut's health is many signals: sleep, stress, heart rhythm, blood, bone and exercise. No single check watches them together, so a small change in one signal goes unnoticed until it becomes a real problem. On long Moon and Mars missions there is no nearby doctor, so the astronaut has to monitor their own health. A single reading, such as today's heart rate, means little unless it is compared with that person's own baseline and trend.

## Solution

AstroVital combines seven health checks into one daily status: **Stable**, **Watch**, or **Act**. Each status comes with plain-language reasons, a label for how strong the evidence is, and what to do next.

- **Seven checks, one view:** sleep, stress, heart rhythm (HRV), blood chemistry, blood metabolites, bone risk and exercise.
- **Personal baseline:** current values are compared with the astronaut's own pre-flight data, not just general ranges.
- **Evidence-aware flagging:** strong evidence (HRV, blood) and weak evidence (sleep, stress, exercise) are kept separate. Weak evidence alone never triggers the highest status.
- **Clear actions:**
  - **Stable**: keep the routine.
  - **Watch**: follow the steps and re-check tomorrow.
  - **Act**: contact the mission medical officer today.

## Features

### 1. Daily status (Stable, Watch or Act)
One combined status per day.

### 2. Seven health checks

| Check | Model / method | Evidence |
|---|---|---|
| Sleep | Logistic regression (probability of poor sleep) | Weak |
| Stress | Ridge regression (daily stress score) | Weak |
| Heart rhythm (HRV) | Isolation Forest (unusual HRV windows) | Strong |
| Blood chemistry | Logistic regression (looks post-flight-like) | Strong |
| Blood metabolites | PCA exploration of cell data | Exploratory |
| Bone risk | Classifier trained on NHANES (Low,  Medium or High) | Screening flag |
| Exercise | Rule: minutes or steps (no trained model) | Weak |

### 3. Personal baseline
Percent change against the astronaut's own pre-flight values.

### 4. 12-page mission-control dashboard
Overview, Vitals & Physical, Radiation Monitor, Mental Wellbeing, Sleep Tracker, Bone & Muscle, Trends & Analytics, Risk Alerts, Insights & Actions, Daily Check-in, Mission Profile, Medical View.

### 5. AI-written advice
Recommendations for alerts, sleep, wellbeing, bone, radiation, mission and insights pages. If the AI is unavailable, rule-based advice is still shown.

### 6. Body map
Symptom logging on 11 regions (head, face, neck, upper/lower back, chest, abdomen, arms, hands, legs, feet) with severity and trends.

### 7. Medical view and escalation
A view for the mission medical officer. Red-flag findings always escalate to the flight surgeon.

### 8. Works offline
Data can be queued and synced later, with conflicts shown for a person to resolve.

## Functionalities 

### Status logic
- **Strong flags:** HRV unusual in more than 10% of windows. Blood probability above 0.5.
- **Weak flags:** poor-sleep probability above 0.5. Stress above 50. Exercise under 20 minutes (or steps under 5,000 if no minutes are logged).
- **Act (red):** two or more strong flags, or one strong plus one weak.
- **Watch (amber):** one strong flag, or one or more weak flags.
- **Stable (green):** no flags.
- **Weak evidence alone never gives Act.**

### Risk engine (rule-based)
- Tiered rules for sleep hours, fatigue, stress, mood, heart rate, blood pressure, SpO2 and body temperature.
- Levels: low, medium, high, critical.
- Each rule stores its source and evidence type (guideline, convention or design).
- Related signals count once (for example systolic and diastolic BP).
- Combined rules: sleep & stress (cognitive performance) and heart + lungs (cardio-respiratory strain).
- Looks back over the last 72 hours of observations.

### Countermeasure engine
- Matches findings to stored protocols.
- Uses only protocols that are active, approved and have a source.
- With no matching protocol, it tells the astronaut to contact the flight surgeon.

### Data ingestion
- Reads CSV and JSON files with a field-mapping step.
- Scripts: `import_dataset.py` and `load_protocols.py`.
- Datasets used: MMASH, NASA OSD-575 / OSD-571 (Inspiration4), OSD-431, CDC NHANES.

### Sync
- Push, status and conflict resolution.
- Conflicts are never auto-overwritten. A person picks `keep_server` or `accept_client`.

### Dashboard data
- Overview and trend endpoints give the direction of each vital (up, down, stable).

### Backend extras
- SQLite storage, models loaded once at startup, `/ml/reload` to refresh them.
- CORS settings, health check and auto-generated docs at `/docs`.
- Frontend demo mode works without a backend.

## Tech Stack

| Layer | Tools |
|---|---|
| Frontend | React 18, Vite, TypeScript, React Router, Zustand, React Query, Axios, Tailwind CSS, Framer Motion, Recharts |
| Backend | FastAPI, Pydantic, SQLAlchemy (SQLite) |
| ML | scikit-learn, pandas, numpy, joblib |
| AI advice | Gemini first, Groq as fallback |
| Testing | pytest, Vitest |

## Project Structure

```
backend/
  app/
    api/v1/endpoints/   # REST routes
    risk_engine/        # rules, scoring, explanations
    countermeasure_engine/
    ml/  services/      # model loading, insight and advice services
    ingestion/  sync/  body_map/  wellbeing/
    models/  schemas/  repositories/  core/
  models/               # trained .pkl files + metrics
  scripts/              # import_dataset.py, load_protocols.py
  tests/
frontend/
  src/modules/          # one folder per page
  src/shared/  services/  hooks/  types/
```

## Getting Started

**Backend** (Python 3.11+)

```bash
cd backend
python -m venv venv
venv/Scripts/activate        # Windows 
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend** (Node.js 18+)

```bash
cd frontend
npm install
npm run dev
```

**Tests and build**

```bash
pytest                 # backend
npm test               # frontend
npm run build
npm run generate:api   # backend must be running
```

**ThankYou From ASTRONova Stellers!**
