from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class AstronautBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    date_of_birth: date | None = None
    sex: str | None = Field(default=None, max_length=20)
    height_cm: float | None = Field(default=None, gt=0, lt=300)
    weight_kg: float | None = Field(default=None, gt=0, lt=500)
    mission_name: str | None = Field(default=None, max_length=120)


class AstronautCreate(AstronautBase):
    # What the client may send when creating. The id and timestamps are server-controlled.
    crew_code: str = Field(min_length=1, max_length=50)


class AstronautUpdate(BaseModel):
    """All fields optional: only the ones sent are changed (crew_code is immutable)."""
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    date_of_birth: date | None = None
    sex: str | None = Field(default=None, max_length=20)
    height_cm: float | None = Field(default=None, gt=0, lt=300)
    weight_kg: float | None = Field(default=None, gt=0, lt=500)
    mission_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class AstronautRead(AstronautBase):
    # What the API returns. from_attributes lets Pydantic read SQLAlchemy objects.
    model_config = ConfigDict(from_attributes=True)

    id: int
    crew_code: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
