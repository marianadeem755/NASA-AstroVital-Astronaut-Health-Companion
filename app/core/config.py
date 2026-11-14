from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AstroVital Astronaut Health Companion"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"

    # SQLite file path (used in the database phase).
    database_url: str = "sqlite:///./data/astrovital.db"

    # Frontend origins allowed to call the API (Next.js dev server).
    # In .env, write as JSON: CORS_ORIGINS=["http://localhost:3000"]
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
