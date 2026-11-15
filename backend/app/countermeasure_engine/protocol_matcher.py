"""Matches findings (risk assessments + reported symptoms) against protocol trigger conditions.
Pure logic: no database, no text generation."""
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.models.countermeasure import CountermeasureProtocol
from app.risk_engine.rules import LEVELS
from app.schemas.recommendation import SymptomInput, TriggerConditions


@dataclass
class Finding:
    kind: str                 # "risk" | "symptom"
    key: str                  # risk category or symptom type
    level: str                # low|medium|high|critical
    description: str
    region: str | None = None
    severity: int | None = None
    ref_id: int | None = None  # risk assessment id, when kind == "risk"


def symptom_level(severity: int) -> str:
    """Design choice: map 1-10 symptom severity to a level."""
    if severity >= 9:
        return "critical"
    if severity >= 7:
        return "high"
    if severity >= 4:
        return "medium"
    return "low"


def build_findings(risk_assessments: list[Any], symptoms: list[SymptomInput]) -> list[Finding]:
    findings = [
        Finding("risk", a.category, a.level, f"{a.category.replace('_', ' ')} risk ({a.level})", ref_id=a.id)
        for a in risk_assessments
    ]
    findings += [
        Finding(
            "symptom", s.symptom_type, symptom_level(s.severity),
            f"{s.symptom_type.replace('_', ' ')} in {s.region_code.replace('_', ' ')} (severity {s.severity}/10)",
            region=s.region_code, severity=s.severity,
        )
        for s in symptoms
    ]
    return findings


def parse_conditions(protocol: CountermeasureProtocol) -> TriggerConditions | None:
    try:
        return TriggerConditions.model_validate(protocol.trigger_conditions)
    except ValidationError:
        return None  # malformed protocols never match


def match_protocol(protocol: CountermeasureProtocol, findings: list[Finding]) -> list[Finding]:
    """Return the findings that trigger this protocol (empty list = no match)."""
    cond = parse_conditions(protocol)
    if cond is None:
        return []
    min_idx = LEVELS.index(cond.min_risk_level)
    matched: list[Finding] = []
    for f in findings:
        if f.kind == "risk":
            if f.key in cond.risk_categories and LEVELS.index(f.level) >= min_idx:
                matched.append(f)
        else:
            for trigger in cond.symptoms:
                if (
                    f.key == trigger.type
                    and (trigger.region is None or f.region == trigger.region)
                    and (f.severity or 0) >= trigger.min_severity
                ):
                    matched.append(f)
                    break
    return matched
