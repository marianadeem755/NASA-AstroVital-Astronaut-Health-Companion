from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root = the folder that contains `app/`, `data/` and `models/`.
BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "AstroVital Astronaut Health Companion"
    app_version: str = "0.2.0"
    api_v1_prefix: str = "/api/v1"

    # SQLite file path (used in the database phase).
    database_url: str = "sqlite:///./data/astrovital.db"

    # Frontend origins allowed to call the API (Next.js dev server).
    # In .env, write as JSON: CORS_ORIGINS=["http://localhost:3000"]
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # ---- ML + data folder -------------------------------------------------
    # Folder that holds the data files (same layout as the AstroVital-Data repo).
    # Files are found by name anywhere under this folder.
    data_dir: Path = BASE_DIR / "data"
    # Folder that holds the 7 trained .pkl files, feature_columns.json,
    # model_metadata.json, metrics.json (and optionally demo_results.json).
    models_dir: Path = BASE_DIR / "models"
    # Optional file that links crew to data sources. Empty = data_dir/profiles/crew_map.json
    crew_map_path: str = ""
    # How many HRV windows make up one "day" check. 0 = use all eligible windows.
    hrv_max_windows: int = 20
    # How many biggest baseline changes to report (and send to the AI).
    baseline_top_n: int = 5

    # ---- AI recommendations (primary + fallback) --------------------------
    # Primary: Google Gemini (free tier, Google AI Studio key).
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    # Fallback: any OpenAI-compatible chat API. Default = xAI Grok.
    # If your key starts with "gsk_" it is a Groq key; the base URL and model
    # then switch to Groq defaults automatically (override them to change).
    grok_api_key: str = ""
    grok_model: str = ""
    grok_base_url: str = ""

    # Free-tier protection (counters live in memory and reset on restart).
    llm_timeout_seconds: float = 25.0
    llm_max_output_tokens: int = 2048
    llm_temperature: float = 0.3
    llm_cache_ttl_seconds: int = 3600
    llm_min_interval_seconds: float = 6.0  # min gap between calls to one provider
    llm_daily_limit_gemini: int = 200  # keep below your AI Studio daily quota
    llm_daily_limit_grok: int = 100

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
