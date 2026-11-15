"""Import every model so Base.metadata knows all tables."""
from app.models.alert import Alert
from app.models.astronaut import Astronaut
from app.models.base import Base
from app.models.body_map import BodyRegion, SymptomReport
from app.models.countermeasure import CountermeasureProtocol, CountermeasureRecommendation
from app.models.dataset import Dataset
from app.models.ml import ModelVersion, Prediction
from app.models.observation import Observation
from app.models.risk import RiskAssessment, RiskFactor
from app.models.sync import SyncConflict, SyncEvent
from app.models.wellbeing import CognitiveAssessment, WellbeingAssessment

__all__ = [
    "Base", "Alert", "Astronaut", "BodyRegion", "SymptomReport", "CountermeasureProtocol",
    "CountermeasureRecommendation", "Dataset", "ModelVersion", "Prediction", "Observation",
    "RiskAssessment", "RiskFactor", "SyncConflict", "SyncEvent", "CognitiveAssessment",
    "WellbeingAssessment",
]
