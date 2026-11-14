from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


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
