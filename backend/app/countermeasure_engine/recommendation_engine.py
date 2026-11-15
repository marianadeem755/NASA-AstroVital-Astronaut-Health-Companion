"""Pure recommendation pipeline:
   findings -> match protocols -> safety filter -> drafts (wording copied VERBATIM from protocols).

Nothing here generates medical text. Every title/description comes from a protocol row;
the only text written here is the 'reason' (which names the triggering findings) and the
fixed escalation wording from safety_checker."""
from dataclasses import dataclass, field

from app.countermeasure_engine import protocol_matcher, safety_checker
from app.countermeasure_engine.protocol_matcher import Finding
from app.models.countermeasure import CountermeasureProtocol
from app.risk_engine.rules import LEVELS
from app.schemas.recommendation import SymptomInput


@dataclass
class RecommendationDraft:
    protocol: CountermeasureProtocol | None   # None = escalation fallback (no protocol)
    title: str
    description: str
    reason: str
    priority: str
    related_factors: list[str]
    requires_medical_review: bool
    escalation_note: str | None = None
    risk_assessment_id: int | None = None
    status: str = "active"


@dataclass
class EngineOutput:
    drafts: list[RecommendationDraft] = field(default_factory=list)
    escalation_required: bool = False
    escalation_instruction: str | None = None
    message: str = ""
    safety_notes: list[str] = field(default_factory=list)


def _max_level(a: str, b: str) -> str:
    return a if LEVELS.index(a) >= LEVELS.index(b) else b


def red_flags(findings: list[Finding]) -> list[str]:
    flags = []
    for f in findings:
        if f.kind == "risk" and f.level == "critical":
            flags.append(f"Critical-level risk: {f.description}")
        elif f.kind == "symptom" and (f.severity or 0) >= safety_checker.SYMPTOM_SEVERITY_RED_FLAG:
            flags.append(f"Severe symptom: {f.description}")
        elif f.kind == "symptom" and f.region == "chest" and (f.severity or 0) >= safety_checker.CHEST_SEVERITY_RED_FLAG:
            flags.append(f"Significant chest symptom: {f.description}")
    return flags


def evaluate(
    protocols: list[CountermeasureProtocol],
    risk_assessments: list,
    symptoms: list[SymptomInput],
) -> EngineOutput:
    out = EngineOutput()
    findings = protocol_matcher.build_findings(risk_assessments, symptoms)
    if not findings:
        out.message = "No risk findings or symptoms reported; no recommendations needed."
        return out

    safety = safety_checker.filter_protocols(protocols)
    out.safety_notes = [f"Protocol {code} not used: {reason}" for code, reason in safety.blocked]
    flags = red_flags(findings)
    out.safety_notes += flags

    for protocol in safety.allowed:
        matched = protocol_matcher.match_protocol(protocol, findings)
        if not matched:
            continue
        priority = protocol.priority
        for f in matched:
            priority = _max_level(priority, f.level)
        if flags:
            priority = "critical"
        risk_ref = next((f.ref_id for f in matched if f.kind == "risk"), None)
        out.drafts.append(
            RecommendationDraft(
                protocol=protocol,
                title=protocol.title,
                description=protocol.description,
                reason="Triggered by: " + "; ".join(f.description for f in matched) + ".",
                priority=priority,
                related_factors=[f.description for f in matched],
                requires_medical_review=True if flags else protocol.requires_medical_review,
                escalation_note=safety_checker.ESCALATION_RED_FLAG if flags else None,
                risk_assessment_id=risk_ref,
            )
        )

    out.drafts.sort(key=lambda d: LEVELS.index(d.priority), reverse=True)

    if flags:
        out.escalation_required = True
        out.escalation_instruction = safety_checker.ESCALATION_RED_FLAG
    if not out.drafts:
        out.escalation_required = True
        out.escalation_instruction = out.escalation_instruction or safety_checker.ESCALATION_NO_PROTOCOL
        out.message = "No approved protocol matches the current findings."
        top = max(findings, key=lambda f: LEVELS.index(f.level))
        out.drafts.append(
            RecommendationDraft(
                protocol=None,
                title="No approved protocol available - medical escalation required",
                description=safety_checker.ESCALATION_NO_PROTOCOL,
                reason="Findings: " + "; ".join(f.description for f in findings) + ".",
                priority=_max_level("medium", top.level),
                related_factors=[f.description for f in findings],
                requires_medical_review=True,
                escalation_note=out.escalation_instruction,
                status="escalation",
            )
        )
    else:
        out.message = f"{len(out.drafts)} recommendation(s) from approved protocols."
    return out
