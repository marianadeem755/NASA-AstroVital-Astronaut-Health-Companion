"""Pure rule evaluation: observations in, risk results out. No database access,
so it is trivial to unit-test and can later be swapped or complemented by an ML model."""
from collections.abc import Sequence
from dataclasses import dataclass, field
from statistics import mean
from typing import Any

from app.risk_engine import explanations
from app.risk_engine.rules import (
    COMBINED_RULES,
    RULES,
    boost_level,
    level_for_score,
)


@dataclass
class FactorResult:
    rule_code: str
    label: str
    factor: str            # metric name
    observed_value: float
    threshold: str
    weight: float
    explanation: str
    severity: str = ""
    source: str = ""
    evidence: str = ""
    group: str = ""


@dataclass
class RiskResult:
    category: str
    level: str
    score: float
    summary: str
    factors: list[FactorResult]
    is_combined: bool = False


@dataclass
class AnalysisResult:
    results: list[RiskResult] = field(default_factory=list)
    not_evaluated: list[str] = field(default_factory=list)  # metrics with no data
    observations_used: int = 0


def score_factors(factors: Sequence[FactorResult]) -> float:
    """Sum of weights, but factors sharing a group (e.g. systolic + diastolic BP) count once
    at their highest weight, so one physiological signal is not double-counted."""
    best: dict[str, float] = {}
    for f in factors:
        best[f.group] = max(best.get(f.group, 0.0), f.weight)
    return sum(best.values())


def _metric_averages(observations: Sequence[Any], metrics: set[str]) -> dict[str, float]:
    averages: dict[str, float] = {}
    for metric in metrics:
        values = [getattr(o, metric) for o in observations if getattr(o, metric, None) is not None]
        if values:
            averages[metric] = mean(values)
    return averages


def analyze(observations: Sequence[Any]) -> AnalysisResult:
    out = AnalysisResult(observations_used=len(observations))
    averages = _metric_averages(observations, {r.metric for r in RULES})

    by_category: dict[str, list[FactorResult]] = {}
    for rule in RULES:
        value = averages.get(rule.metric)
        if value is None:
            # Missing data is reported explicitly, never treated as "normal".
            if rule.metric not in out.not_evaluated:
                out.not_evaluated.append(rule.metric)
            continue
        tier = rule.match(value)
        if tier:
            by_category.setdefault(rule.category, []).append(
                FactorResult(
                    rule_code=rule.code, label=rule.label, factor=rule.metric,
                    observed_value=round(value, 2), threshold=tier.text, weight=tier.weight,
                    explanation=explanations.factor_explanation(rule, tier, value),
                    severity=tier.severity, source=rule.source, evidence=rule.evidence,
                    group=rule.group_key,
                )
            )

    category_results: dict[str, RiskResult] = {}
    for category, factors in by_category.items():
        score = score_factors(factors)
        level = level_for_score(score)
        labels = [f.label for f in factors]
        category_results[category] = RiskResult(
            category, level, score, explanations.category_summary(category, level, labels), factors
        )
    out.results.extend(category_results.values())

    # Cascading: combinations of categories escalate beyond their individual levels.
    for crule in COMBINED_RULES:
        if crule.requires <= category_results.keys():
            parts = [category_results[c] for c in sorted(crule.requires)]
            factors = [f for p in parts for f in p.factors]
            base = max(parts, key=lambda p: p.score)
            level = boost_level(base.level, crule.level_boost)
            labels = [f.label for f in factors]
            out.results.append(
                RiskResult(
                    f"combined_{crule.code.lower()}", level, score_factors(factors),
                    explanations.combined_summary(crule, level, labels), factors, is_combined=True,
                )
            )
    return out
