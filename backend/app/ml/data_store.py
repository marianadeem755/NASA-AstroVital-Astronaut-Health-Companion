"""Reads the data folder and builds the exact rows the trained models expect.

Nothing is typed in by the user. Drop the CSV files (same layout as the
AstroVital-Data repo) anywhere under `settings.data_dir` and this module finds
them by file name. Missing values stay missing (never imputed here).
"""
import json
import threading
from pathlib import Path

import pandas as pd

from app.core.config import settings
from app.ml import predict

# File-name patterns (the file may sit in any sub-folder of data_dir).
FILES = {
    "sleep": "MMASH_sleep_summary*.csv",
    "psych": "MMASH_psychological_scores*.csv",
    "activity": "MMASH_activity_summary_quality_reviewed*.csv",
    "hrv": "MMASH_RR_HRV_final_all_windows*.csv",
    "insp4": "Inspiration4_integrated_serum_CBC_metabolomics*.csv",
    "osd571": "OSD-571_ANP_RP_metabolomics_combined*.csv",
}
HRV_COLS = ["mean_hr_bpm", "rr_sdnn_ms", "rr_rmssd_ms", "rr_pnn50_percent"]
PREFLIGHT_PREFIX = "L-"  # Inspiration4 timepoints before launch: L-92, L-44, L-3
BLOOD_ID_COLS = ("astronaut", "timepoint")

_LOCK = threading.RLock()
_CACHE = {}


class DataNotFound(Exception):
    """A required data file is not in the data folder."""


def clear_cache():
    with _LOCK:
        _CACHE.clear()


def _find(key):
    pattern = FILES[key]
    hits = sorted(Path(settings.data_dir).rglob(pattern))
    if not hits:
        raise DataNotFound(f"{pattern} not found under {settings.data_dir}")
    return hits[0]


def _read(key):
    with _LOCK:
        if key not in _CACHE:
            _CACHE[key] = pd.read_csv(_find(key))
        return _CACHE[key]


def available_files():
    """{key: path or None} for the status endpoint."""
    out = {}
    for key, pattern in FILES.items():
        hits = sorted(Path(settings.data_dir).rglob(pattern))
        out[key] = str(hits[0].relative_to(settings.data_dir)) if hits else None
    return out


# --------------------------------------------------------------------------
# MMASH (sleep / stress / activity / HRV)
# --------------------------------------------------------------------------
def mmash_merged():
    """Same merged table the sleep and stress models were trained on."""
    with _LOCK:
        if "mmash_merged" in _CACHE:
            return _CACHE["mmash_merged"]
        sleep, psych, activity, hrv = (_read(k) for k in ("sleep", "psych", "activity", "hrv"))
        hrv_col = "hrv_mean_rr_rmssd_ms"
        # Training excluded the participant whose HRV sensor/unit was broken
        # (very high RMSSD). Find it from the data, do not name it here.
        bad = _unit_problem_participants(hrv)
        hrv_means = (
            hrv[~hrv["participant_id"].isin(bad)]
            .groupby("participant_id")[HRV_COLS].mean().add_prefix("hrv_mean_")
        )
        merged = (
            sleep.merge(psych, on="participant_id")
            .merge(activity, on="participant_id")
            .merge(hrv_means, on="participant_id", how="left")
            .dropna(subset=["sleep_efficiency_percent"])
            .reset_index(drop=True)
        )
        if hrv_col not in merged.columns:
            raise DataNotFound("HRV means could not be built from the HRV file")
        _CACHE["mmash_merged"] = merged
        return merged


def _unit_problem_participants(hrv):
    """Participants whose median RMSSD is an extreme outlier vs the others
    (> 5x the median of the participant medians). Derived from the data."""
    med = hrv[hrv["eligible"] == True].groupby("participant_id")["rr_rmssd_ms"].median()  # noqa: E712
    if med.empty:
        return []
    return med[med > 5 * med.median()].index.tolist()


def mmash_users():
    return mmash_merged()["participant_id"].tolist()


def hrv_users():
    hrv = _read("hrv")
    return sorted(hrv["participant_id"].unique().tolist())


def _hrv_anomaly_by_user():
    with _LOCK:
        if "hrv_anomaly" in _CACHE:
            return _CACHE["hrv_anomaly"]
        hrv = _read("hrv")
        ok = hrv[hrv["eligible"] == True].dropna(subset=HRV_COLS)  # noqa: E712
        m = predict.require_model("hrv_anomaly_isoforest")
        flagged = pd.Series(m.predict(ok[predict._features(m)]) == -1, index=ok.index)
        frac = flagged.groupby(ok["participant_id"]).mean().sort_values()
        _CACHE["hrv_anomaly"] = frac
        return frac


def resolve_mmash_user(selector):
    """'user_7' -> 'user_7'. 'auto:good' / 'auto:poor' pick a user from the data
    (lowest / highest PSQI-then-stress), the way the team demo did."""
    if selector is None:
        return None
    m = mmash_merged()
    if selector == "auto:good":
        return m.sort_values(["Pittsburgh", "Daily_stress"]).iloc[0]["participant_id"]
    if selector == "auto:poor":
        poor = m[m["Pittsburgh"] > 5]  # PSQI > 5 = poor sleeper (model card 01 target)
        poor = poor if len(poor) else m
        return poor.sort_values("Daily_stress", ascending=False).iloc[0]["participant_id"]
    return selector


def resolve_hrv_user(selector):
    """'auto:normal' = user with the lowest share of unusual windows,
    'auto:anomalous' = the highest. Computed with the HRV model."""
    if selector is None:
        return None
    if selector == "auto:normal":
        return _hrv_anomaly_by_user().index[0]
    if selector == "auto:anomalous":
        return _hrv_anomaly_by_user().index[-1]
    return selector


def mmash_row(user):
    """One-row DataFrame for the sleep + stress models, or None."""
    if user is None:
        return None
    m = mmash_merged()
    row = m[m["participant_id"] == user]
    return row.iloc[[0]] if len(row) else None


def steps_per_day(row):
    """Average daily steps from the activity summary (total / recorded days)."""
    if row is None:
        return None
    total, days = row["total_steps"].iloc[0], row["recorded_days"].iloc[0]
    if pd.isna(total) or pd.isna(days) or days <= 0:
        return None
    return int(total // days)


def hrv_windows(user, limit=None):
    """Eligible HRV windows for one participant, in time order."""
    if user is None:
        return None
    hrv = _read("hrv")
    w = hrv[(hrv["participant_id"] == user) & (hrv["eligible"] == True)]  # noqa: E712
    w = w.sort_values("window_number")
    limit = settings.hrv_max_windows if limit is None else limit
    if limit and limit > 0:
        w = w.head(limit)
    return w if len(w) else None


# --------------------------------------------------------------------------
# Inspiration4 blood + OSD-571 metabolomics
# --------------------------------------------------------------------------
def blood_astronauts():
    return sorted(_read("insp4")["astronaut"].unique().tolist())


def blood_timepoints(astronaut):
    d = _read("insp4")
    tps = d[d["astronaut"] == astronaut]["timepoint"].tolist()

    # before launch first (L-92 < L-44 < L-3), then after landing (R+1 < R+45 < R+82)
    return sorted(tps, key=lambda t: (0 if t.startswith("L") else 1, -int(t[2:]) if t.startswith("L") else int(t[2:])))


def blood_rows(astronaut, timepoint):
    """(insp4_row, osd571_row) as 1-row DataFrames; each is None if absent."""
    if astronaut is None or timepoint is None:
        return None, None
    out = []
    for key in ("insp4", "osd571"):
        try:
            d = _read(key)
        except DataNotFound:
            out.append(None)
            continue
        r = d[(d["astronaut"] == astronaut) & (d["timepoint"] == timepoint)]
        out.append(r.iloc[[0]] if len(r) else None)
    return out[0], out[1]


def baseline_changes(astronaut, timepoint, top_n=None):
    """Percent change of each blood value vs the astronaut's own pre-flight mean
    (timepoints starting with L-). Returns the `top_n` biggest changes."""
    top_n = settings.baseline_top_n if top_n is None else top_n
    if astronaut is None or timepoint is None or timepoint.startswith(PREFLIGHT_PREFIX):
        return []
    d = _read("insp4")
    cols = predict._features(predict.require_model("insp4_postflight_logreg"))
    mine = d[d["astronaut"] == astronaut]
    pre = mine[mine["timepoint"].str.startswith(PREFLIGHT_PREFIX)]
    cur = mine[mine["timepoint"] == timepoint]
    if pre.empty or cur.empty:
        return []
    rows = []
    for c in cols:
        base = pre[c].mean()
        val = cur[c].iloc[0]
        if pd.isna(base) or pd.isna(val):
            continue
        pct = predict.baseline_change(pre[c], val)
        if pct is None:
            continue
        rows.append({
            "marker": c.replace("serum__", "").replace("_value", ""),
            "baseline_mean": round(float(base), 2),
            "current": round(float(val), 2),
            "percent_change": pct,
        })
    rows.sort(key=lambda r: abs(r["percent_change"]), reverse=True)
    return rows[:top_n]


# --------------------------------------------------------------------------
# Crew map (optional file that links subjects to data sources)
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# Crew map (optional file that links subjects to data sources)
# --------------------------------------------------------------------------
def _crew_map_path():
    if settings.crew_map_path:
        return Path(settings.crew_map_path)
    return Path(settings.data_dir) / "profiles" / "crew_map.json"


def _derived_crew_map():
    """crew_map.json nahi hai to data se khud subjects banao (kuch hardcode nahi)."""
    try:
        astronauts = blood_astronauts()
    except DataNotFound:
        return {"subjects": [], "scenarios": []}
    subjects = []
    for a in astronauts:
        tps = blood_timepoints(a)
        subjects.append({
            "subject_id": a,
            "display_name": a,
            "blood_astronaut": a,
            "timepoint": tps[-1] if tps else None,  # sabse aakhri timepoint
        })
    return {"subjects": subjects, "scenarios": []}


def crew_map():
    """{'subjects': [...], 'scenarios': [...]}. File na ho to data se derive hota hai."""
    p = _crew_map_path()
    if not p.exists():
        return _derived_crew_map()
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    return {"subjects": data.get("subjects", []), "scenarios": data.get("scenarios", [])}


def get_subject(subject_id):
    for s in crew_map()["subjects"]:
        if s.get("subject_id") == subject_id:
            return s
    return None


def get_scenario(scenario_id):
    for s in crew_map()["scenarios"]:
        if s.get("scenario_id") == scenario_id:
            return s
    return None
