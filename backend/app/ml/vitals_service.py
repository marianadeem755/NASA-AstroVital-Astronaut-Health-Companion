"""Deep-dive numbers for the Vitals & Physical page  (POST/GET /api/v1/ml/vitals-insight).

Same rule as the rest of ml_service: nothing is typed in. The frontend only says WHICH data to
look at (scenario / subject / hrv_user / blood_astronaut / timepoint) and this module reads the
data folder, runs the saved models and returns plain numbers:

  hrv       every HRV window of the checked day with its own model score, the volunteer
            reference band for each measure, what drives an unusual result, how long it lasts
  blood     every Inspiration4 blood value for the whole mission compared with the astronaut's
            OWN pre-flight range, how many values are outside it over time, a recovery outlook
            (straight-line projection) and the other crew for context
  activity  steps / mean heart rate / movement of the selected volunteer vs the 21 volunteers

Nothing here changes the Good / Warning / Critical level. That stays in app/ml/predict.py.
Existing functions in ml_service.py / data_store.py / predict.py are used as they are.
"""
import math
import re
from statistics import median

import numpy as np
import pandas as pd

from app.core.config import settings
from app.core.exceptions import AppError
from app.ml import data_store, predict
from app.schemas.ml import DayRequest
from app.services import ml_service

# ---- design choices (written here so the team can read and change them) ---------------------
MOVE_MIN_PCT = 5.0            # a blood value must move at least 5% from the baseline mean to count as "outside"
REF_LOW, REF_HIGH = 0.05, 0.95  # volunteer reference band for the HRV measures (5th to 95th percentile)
MIN_WINDOWS_FOR_HALVES = 6    # first-half vs second-half comparison needs at least this many HRV windows
LONG_RECOVERY_DAYS = 365      # a straight-line recovery estimate beyond this is reported as "over a year"

HRV_MEASURES = [  # (short key, column in the HRV file, label, unit)
    ("hr", "mean_hr_bpm", "Mean heart rate", "bpm"),
    ("sdnn", "rr_sdnn_ms", "SDNN (overall variability)", "ms"),
    ("rmssd", "rr_rmssd_ms", "RMSSD (beat-to-beat variability)", "ms"),
    ("pnn50", "rr_pnn50_percent", "pNN50 (large beat changes)", "%"),
]

_UNITS = [  # longest first, so the eGFR unit is not cut short
    ("milliliter_per_minute_per_1.73_meter_squared", "mL/min/1.73m²"),
    ("thousand_per_microliter", "K/µL"), ("million_per_microliter", "M/µL"), ("cells_per_microliter", "cells/µL"),
    ("milligram_per_deciliter", "mg/dL"), ("grams_per_deciliter", "g/dL"), ("gram_per_deciliter", "g/dL"),
    ("millimol_per_liter", "mmol/L"), ("units_per_liter", "U/L"),
    ("picogram", "pg"), ("femtoliter", "fL"), ("percent", "%"),
]
_ACRONYMS = {"alt": "ALT", "ast": "AST", "bun": "BUN", "mch": "MCH", "mchc": "MCHC", "mcv": "MCV",
             "mpv": "MPV", "rdw": "RDW", "egfr": "eGFR"}
_PANELS = {"serum": "chemistry", "cbc": "cbc"}


# ---------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------
def _clean(obj):
    """numpy -> plain python, NaN / inf -> None (JSON cannot carry them)."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]