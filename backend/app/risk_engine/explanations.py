"""Plain-language explanations. Wording avoids diagnosis."""
from app.risk_engine.rules import CombinedRule, Rule, Tier

DISCLAIMER = (
    "Decision-support only. This is not a medical diagnosis. Thresholds come from general-population "
    "reference ranges, not NASA flight-surgeon limits, pending clinical approval; consult the flight surgeon for medical decisions."
)


def factor_explanation(rule: Rule, tier: Tier, value: float) -> str:
    return (
        f"{rule.label} ({tier.severity}): average {value:.1f} over the analysis window "
        f"(rule {rule.code}: flagged when {tier.text})."
    )


def category_summary(category: str, level: str, factor_labels: list[str]) -> str:
    pretty = category.replace("_", " ")
    return f"{level.capitalize()} {pretty} concern based on: {'; '.join(factor_labels)}."


def combined_summary(rule: CombinedRule, level: str, factor_labels: list[str]) -> str:
    return f"{level.capitalize()} - {rule.name}. {rule.description} Contributing: {'; '.join(factor_labels)}."
