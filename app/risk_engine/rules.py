"""Declarative, tiered risk rules.

Each rule maps a metric to severity TIERS (most severe first). Thresholds are taken from
widely published general-population references, and each rule records its source and an
`evidence` label so the team always knows how strong the basis is:

  - "guideline":   cut-off comes from a published clinical guideline / consensus statement
  - "convention":  common practice, NOT a validated cut-off for this construct
  - "design":      our own engineering choice (e.g. how scores map to levels)

IMPORTANT LIMITS
  * These are general-population references, NOT NASA flight-surgeon limits. Spaceflight
    physiology differs (e.g. ISS crews average ~6 h sleep). Before operational use,
    replace/confirm every value with NASA-approved references and flight-surgeon review.
  * Heart rate / BP rules assume readings are comparable to resting values.
  * This is decision support, never a diagnosis.

To change behaviour, edit this file only; the calculator is generic.
"""
from dataclasses import dataclass
from operator import ge, gt, le, lt

LEVELS = ["low", "medium", "high", "critical"]
ENGINE_VERSION = "rules-0.2-reference-ranges"

# Lookback window of observations used for analysis (design choice).
LOOKBACK_HOURS = 72

_OPS = {"lt": lt, "le": le, "gt": gt, "ge": ge}
_OP_TEXT = {"lt": "<", "le": "<=", "gt": ">", "ge": ">="}

# ---- Sources -------------------------------------------------------------------------
SRC_AASM_SLEEP = (
    "AASM/SRS Consensus Statement on Recommended Amount of Sleep for a Healthy Adult (2015): "
    ">=7 h/night recommended; <=6 h inadequate for health and safety."
)
SRC_BARGER_ISS = "Barger et al., Lancet Neurology 2014: ISS crews averaged ~6 h sleep in orbit."
SRC_ACC_AHA_BP = (
    "2017 ACC/AHA Hypertension Guideline: stage 1 >=130/80, stage 2 >=140/90, "
    "severe/crisis range >180/120 mmHg."
)
SRC_HR = "General clinical reference: normal adult resting HR 60-100 bpm; >100 = tachycardia range."
SRC_SPO2 = "General clinical reference: normal SpO2 95-100%; <90% = hypoxemia (consumer-level sources vary on intermediate bands)."
SRC_TEMP = "General clinical reference: fever >=38.0 C (100.4 F); >=39.0 C = high fever."
SRC_NRS = (
    "Numeric rating scale convention (e.g. pain NRS: 7-10 severe). Not a validated cut-off "
    "for fatigue/stress/mood; replace with the instrument NASA uses."
)


@dataclass(frozen=True)
class Tier:
    op: str          # lt | le | gt | ge
    threshold: float
    weight: float
    severity: str    # label shown to users

    def matches(self, value: float) -> bool:
        return _OPS[self.op](value, self.threshold)

    @property
    def text(self) -> str:
        return f"{_OP_TEXT[self.op]} {self.threshold:g}"


@dataclass(frozen=True)
class Rule:
    code: str
    category: str
    metric: str                  # field name on Observation
    tiers: tuple[Tier, ...]      # ordered MOST severe first; first match wins
    label: str
    source: str
    evidence: str                # guideline | convention | design
    group: str | None = None     # rules sharing a group count once (highest weight)

    @property
    def group_key(self) -> str:
        return self.group or self.code

    def match(self, value: float) -> Tier | None:
        return next((t for t in self.tiers if t.matches(value)), None)


@dataclass(frozen=True)
class CombinedRule:
    """Cascading risk: fires when factors from ALL listed categories are present."""
    code: str
    name: str
    requires: frozenset[str]
    description: str
    level_boost: int = 1  # steps above the highest component level


RULES: list[Rule] = [
    Rule("SLEEP_LOW", "sleep_fatigue", "sleep_hours",
         (Tier("lt", 5, 3.0, "severely short"), Tier("le", 6, 2.0, "inadequate"),
          Tier("lt", 7, 1.0, "below recommended")),
         "Short sleep duration", f"{SRC_AASM_SLEEP} {SRC_BARGER_ISS}", "guideline"),
    Rule("FATIGUE_HIGH", "sleep_fatigue", "fatigue_level",
         (Tier("ge", 9, 3.0, "very severe"), Tier("ge", 7, 2.0, "severe")),
         "High reported fatigue", SRC_NRS, "convention"),
    Rule("STRESS_HIGH", "psychological", "stress_level",
         (Tier("ge", 9, 3.0, "very severe"), Tier("ge", 7, 2.0, "severe")),
         "High reported stress", SRC_NRS, "convention"),
    Rule("MOOD_LOW", "psychological", "mood_score",
         (Tier("le", 1, 3.0, "very low"), Tier("le", 3, 2.0, "low")),
         "Low reported mood", SRC_NRS, "convention"),
    Rule("HR_HIGH", "cardiovascular", "heart_rate_bpm",
         (Tier("gt", 120, 3.0, "markedly elevated"), Tier("gt", 100, 2.0, "elevated")),
         "Elevated heart rate", SRC_HR, "guideline"),
    Rule("BP_SYS_HIGH", "cardiovascular", "systolic_bp",
         (Tier("gt", 180, 5.0, "severe range"), Tier("ge", 140, 2.0, "stage 2 range"),
          Tier("ge", 130, 1.0, "stage 1 range")),
         "Elevated systolic blood pressure", SRC_ACC_AHA_BP, "guideline", group="blood_pressure"),
    Rule("BP_DIA_HIGH", "cardiovascular", "diastolic_bp",
         (Tier("gt", 120, 5.0, "severe range"), Tier("ge", 90, 2.0, "stage 2 range"),
          Tier("ge", 80, 1.0, "stage 1 range")),
         "Elevated diastolic blood pressure", SRC_ACC_AHA_BP, "guideline", group="blood_pressure"),
    Rule("SPO2_LOW", "respiratory", "spo2_percent",
         (Tier("lt", 90, 5.0, "hypoxemia range"), Tier("lt", 95, 1.0, "below normal range")),
         "Low blood oxygen saturation", SRC_SPO2, "guideline"),
    Rule("TEMP_HIGH", "thermal", "body_temperature_c",
         (Tier("ge", 39.0, 3.0, "high fever range"), Tier("ge", 38.0, 2.0, "fever range")),
         "Elevated body temperature", SRC_TEMP, "guideline"),
]

COMBINED_RULES: list[CombinedRule] = [
    CombinedRule(
        "COGNITIVE_PERFORMANCE",
        "Possible reduced cognitive performance",
        frozenset({"sleep_fatigue", "psychological"}),
        "Sleep/fatigue and psychological stress factors are present together, which may "
        "compound performance risk.",
    ),
    CombinedRule(
        "CARDIO_RESPIRATORY",
        "Combined cardiovascular and respiratory strain",
        frozenset({"cardiovascular", "respiratory"}),
        "Cardiovascular and oxygenation factors are present together.",
    ),
]

# Score -> level (design choice, evidence="design"). Checked from highest to lowest.
LEVEL_CUTOFFS = [(5.0, "critical"), (3.0, "high"), (2.0, "medium"), (0.0, "low")]


def level_for_score(score: float) -> str:
    for cutoff, level in LEVEL_CUTOFFS:
        if score >= cutoff:
            return level
    return "low"


def boost_level(level: str, steps: int) -> str:
    return LEVELS[min(LEVELS.index(level) + steps, len(LEVELS) - 1)]
