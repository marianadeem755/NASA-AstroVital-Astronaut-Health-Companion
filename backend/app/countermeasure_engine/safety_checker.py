"""Safety layer for recommendations.

Guarantees enforced here (in addition to the matcher only seeing database protocols):
  1. Only protocols that are active AND approved AND carry a source reference are usable.
  2. Protocol text must not contain medication / dosing / prescription language.
     (A keyword screen is defence-in-depth, NOT a guarantee. Human approval of protocol
     text is the real control.)
  3. Red-flag findings force medical escalation and can only ever RAISE
     requires_medical_review, never lower it.
"""
import re
from dataclasses import dataclass, field

from app.models.countermeasure import CountermeasureProtocol

DISCLAIMER = (
    "Decision-support only. Recommendations come from predefined protocols and are not a "
    "diagnosis or prescription. Contact the flight surgeon for any medical concern."
)
ESCALATION_RED_FLAG = (
    "Escalate immediately to the flight surgeon / medical officer. Do not rely on automated "
    "recommendations for this finding."
)
ESCALATION_NO_PROTOCOL = (
    "No approved protocol matches these findings. Do not self-treat; contact the flight "
    "surgeon / medical officer for guidance."
)

APPROVED_STATUS = "approved"

_DOSE = re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|ml|iu|units?)\b", re.IGNORECASE)
_MED_WORDS = re.compile(
    r"\b(prescri\w*|dos(?:e|es|age)|tablets?|capsules?|pills?|inject\w*|medicat\w*|drugs?|"
    r"sedative\w*|hypnotic\w*|antibiotic\w*|analgesic\w*)\b",
    re.IGNORECASE,
)

SYMPTOM_SEVERITY_RED_FLAG = 8
CHEST_SEVERITY_RED_FLAG = 7


@dataclass
class SafetyResult:
    allowed: list[CountermeasureProtocol] = field(default_factory=list)
    blocked: list[tuple[str, str]] = field(default_factory=list)  # (protocol code, reason)


def text_violation(text: str) -> str | None:
    if _DOSE.search(text):
        return "contains a dosage"
    if match := _MED_WORDS.search(text):
        return f"contains medication language ('{match.group(0)}')"
    return None


def protocol_violation(protocol: CountermeasureProtocol) -> str | None:
    if not protocol.is_active:
        return "protocol is not active"
    if protocol.approval_status != APPROVED_STATUS:
        return f"protocol approval status is '{protocol.approval_status}'"
    if not protocol.source_reference:
        return "protocol has no source reference"
    return text_violation(f"{protocol.title}. {protocol.description}")


def filter_protocols(protocols: list[CountermeasureProtocol]) -> SafetyResult:
    result = SafetyResult()
    for protocol in protocols:
        reason = protocol_violation(protocol)
        if reason:
            result.blocked.append((protocol.code, reason))
        else:
            result.allowed.append(protocol)
    return result
