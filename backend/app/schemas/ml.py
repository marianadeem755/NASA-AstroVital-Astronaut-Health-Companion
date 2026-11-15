from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class BoneProfile(BaseModel):
    """Inputs of the NHANES bone-risk model (card 07). All optional: missing
    values are filled by the model with the training median."""
    age: Optional[float] = Field(None, ge=0, le=120, description="years (model trained on 40-80)")
    sex_female: Optional[Literal[0, 1]] = Field(None, description="1 = female, 0 = male")
    bmi: Optional[float] = Field(None, ge=10, le=80)
    grip_max_kg: Optional[float] = Field(None, ge=0, le=120)
    vig_work_min_week: Optional[float] = Field(None, ge=0, le=10080)
    mod_work_min_week: Optional[float] = Field(None, ge=0, le=10080)
    vig_rec_min_week: Optional[float] = Field(None, ge=0, le=10080)
    mod_rec_min_week: Optional[float] = Field(None, ge=0, le=10080)
    sedentary_min_day: Optional[float] = Field(None, ge=0, le=1440)
    sleep_hours: Optional[float] = Field(None, ge=0, le=24)
    trouble_sleeping: Optional[Literal[0, 1]] = None


class DayRequest(BaseModel):
    """Which data in the data folder to use for this day. Nothing is typed in:
    every field is either a name of something in the data folder or optional.
    Fields you leave out are taken from the scenario / subject in
    data/profiles/crew_map.json (if any)."""
    scenario_id: Optional[str] = Field(None, description="Ready-made day from crew_map.json")
    subject_id: Optional[str] = Field(None, description="Crew member from crew_map.json")
    mmash_user: Optional[str] = Field(None, description="MMASH participant, e.g. user_1, or auto:good / auto:poor")
    hrv_user: Optional[str] = Field(None, description="MMASH HRV participant, or auto:normal / auto:anomalous")
    blood_astronaut: Optional[str] = Field(None, description="Inspiration4 crew id, e.g. C001")
    timepoint: Optional[str] = Field(None, description="Blood sample time, e.g. L-3, R+1, R+45")
    exercise_minutes: Optional[float] = Field(None, ge=0, le=1440)
    steps: Optional[int] = Field(None, ge=0, le=200000)
    bone_profile: Optional[BoneProfile] = None
    language: Literal["en", "roman-urdu"] = "en"


class BoneRequest(BaseModel):
    bone_profile: BoneProfile


class RadiationPhase(BaseModel):
    label: str = Field(..., max_length=60)
    environment: str = Field(..., max_length=60)
    days: int = Field(..., ge=1, le=2000)
    rate_msv_per_day: float = Field(..., ge=0, le=20)
    dose_msv: float = Field(..., ge=0, le=20000)


class RadiationRequest(BaseModel):
    """Summary of the Radiation Monitor set-up. The numbers come from the frontend's reference
    exposure model (published dose rates), not from a dosimeter, unless measured_dose_msv is given.
    Every field is range-checked, free text is length-limited."""
    mission: Literal["mars", "moon"]
    mission_label: str = Field(..., max_length=80)
    mission_day: int = Field(..., ge=1, le=2000)
    mission_total_days: int = Field(..., ge=1, le=2000)
    phase: str = Field(..., max_length=60)
    phase_days_left: int = Field(..., ge=0, le=2000)
    environment: str = Field(..., max_length=60)
    dose_rate_msv_per_day: float = Field(..., ge=0, le=20)
    dose_to_date_msv: float = Field(..., ge=0, le=20000)
    prior_career_dose_msv: float = Field(0, ge=0, le=5000)
    career_dose_now_msv: float = Field(..., ge=0, le=25000)
    career_dose_end_of_plan_msv: float = Field(..., ge=0, le=25000)
    nasa_limit_msv: float = Field(600, ge=1, le=5000)
    esa_limit_msv: float = Field(1000, ge=1, le=5000)
    share_of_nasa_limit_now_pct: float = Field(..., ge=0, le=5000)
    share_of_nasa_limit_end_pct: float = Field(..., ge=0, le=5000)
    plan_crosses_nasa_limit_on_day: Optional[int] = Field(None, ge=1, le=2000)
    shielding_scenario: str = Field(..., max_length=60)
    shielding_factor: float = Field(..., ge=0.3, le=1.2)
    shielding_saving_msv: float = Field(0, ge=0, le=20000)
    transit_dose_share_pct: Optional[float] = Field(None, ge=0, le=100)
    uncertainty_pct: float = Field(20, ge=0, le=100)
    measured_dose_msv: Optional[float] = Field(None, ge=0, le=25000)
    measured_vs_expected_pct: Optional[float] = Field(None, ge=-100, le=10000)
    phases: list[RadiationPhase] = Field(..., min_length=1, max_length=8)
    language: Literal["en", "roman-urdu"] = "en"

class WellbeingAdviceRequest(BaseModel):
    """Mental Wellbeing AI advice. The frontend sends only WHICH data to use; the backend rebuilds the
    summary itself from the astronaut's check-ins and the selected MMASH volunteer, so no health value
    is ever taken from the browser."""
    astronaut_id: int = Field(1, ge=1)
    scenario_id: Optional[str] = Field(None, max_length=80)
    subject_id: Optional[str] = Field(None, max_length=80)
    mmash_user: Optional[str] = Field(None, max_length=80)
    days: int = Field(30, ge=7, le=365)
    language: Literal["en", "roman-urdu"] = "en"


class SleepInsightRequest(BaseModel):
    """Sleep Tracker: which astronaut's own nights and which MMASH volunteer to look at. No health value is sent."""
    astronaut_id: int = Field(1, ge=1)
    scenario_id: Optional[str] = Field(None, max_length=80)
    subject_id: Optional[str] = Field(None, max_length=80)
    mmash_user: Optional[str] = Field(None, max_length=80)
    days: int = Field(30, ge=7, le=365)
    language: Literal["en", "roman-urdu"] = "en"


class BoneMuscleRequest(DayRequest):
    """Bone & Muscle deep dive: the same selectors as every other page (including the bone profile typed in the
    calculator) plus which astronaut's exercise log and symptom reports to read."""
    astronaut_id: int = Field(1, ge=1)
    days: int = Field(30, ge=7, le=365)


class AnalyticsInsightRequest(BaseModel):
    """Trends & Analytics deep dive: which astronaut's logged data to read and how many days back. No health value is sent."""
    astronaut_id: int = Field(1, ge=1)
    days: int = Field(30, ge=7, le=365)


class AlertsInsightRequest(DayRequest):
    """Risk Alerts deep dive: the same data selectors as every page (so the model flags match) plus whose logged data to read."""
    astronaut_id: int = Field(1, ge=1)
    days: int = Field(30, ge=7, le=90)


class MissionProfileSave(BaseModel):
    """Mission details typed on the Mission Profile page. Only what is sent is changed; an empty string clears a text field."""
    astronaut_id: int = Field(1, ge=1)
    mission_name: Optional[str] = Field(None, max_length=120)
    destination: Optional[str] = Field(None, max_length=80)
    launch_date: Optional[date] = None
    planned_days: Optional[int] = Field(None, ge=1, le=1500)
    crew_role: Optional[str] = Field(None, max_length=40)
    crew_size: Optional[int] = Field(None, ge=1, le=12)
    objective: Optional[str] = Field(None, max_length=200)
    date_of_birth: Optional[date] = None
    sex: Optional[str] = Field(None, max_length=20)
    height_cm: Optional[float] = Field(None, ge=100, le=230, description="centimetres, not metres")
    weight_kg: Optional[float] = Field(None, ge=30, le=250)

    @field_validator("date_of_birth")
    @classmethod
    def _plausible_birth(cls, v):
        if v is None:
            return v
        today = date.today()
        age = today.year - v.year - ((today.month, today.day) < (v.month, v.day))
        if age < 18 or age > 80:
            raise ValueError("Date of birth looks wrong: the astronaut must be 18 to 80 years old")
        return v
