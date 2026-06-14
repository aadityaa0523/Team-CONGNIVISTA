from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # MQTT
    mqtt_broker_host: str = "localhost"
    mqtt_broker_port: int = 1883
    mqtt_topic: str = "hydromind/#"

    # InfluxDB
    influx_url: str = "http://localhost:8086"
    influx_token: str = ""
    influx_org: str = "hydromind"
    influx_bucket: str = "sensor_readings"

    # MongoDB
    mongo_uri: str = ""
    mongo_db: str = "hydromind"

    # External APIs
    owm_api_key: str = ""
    sarvam_api_key: str = ""
    gemini_api_key: str = ""
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    # Alert thresholds — river nodes (cm; lower distance = higher water)
    alert_yellow_cm: int = 80
    alert_orange_cm: int = 60
    alert_red_cm: int = 40

    # Alert thresholds — urban drains (fill %)
    drain_watch_pct: int = 60
    drain_warning_pct: int = 75
    drain_critical_pct: int = 85

    # Sewer safety thresholds (ppm methane)
    methane_caution_ppm: int = 200
    methane_danger_ppm: int = 500
    methane_critical_ppm: int = 1000

    # n8n
    n8n_webhook_url: str = ""

    # Deployment
    vultr_host: str = ""


settings = Settings()
