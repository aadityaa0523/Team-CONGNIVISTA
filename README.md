# 🌊 HydroMind Sentinel — Team CONGNIVISTA

> **An AI-powered, real-time flood early-warning and urban drainage intelligence platform for Indian cities.**

HydroMind Sentinel turns low-cost IoT sensors into a city-scale **digital twin** of drainage infrastructure — predicting floods *2 hours ahead*, scoring drain health, evaluating sewer-worker safety, and broadcasting **multilingual (Telugu / Tamil / English) SMS, voice, and Telegram alerts** before water reaches the streets.

**Tracks:** IoT· Sustainable Development
**Hardware cost:** ₹560/node — ~30× denser coverage than ₹17,000 manual gauges.

---

## 🎯 The Problem

Existing flood systems watch **reservoirs, rivers, and rainfall stations** — but urban flooding *begins at the drain level*, hours before regional forecasts react. Authorities and citizens cannot answer the questions that actually matter in the moment:

- Which drain is about to overflow, and **how many minutes** are left?
- Which drains need urgent maintenance?
- **Is it safe** for a worker to enter that sewer right now?
- Which localities — schools, hospitals, transit — face the greatest impact?

## 💡 The Solution

A network of **ESP32 nodes** (ultrasonic water-level + MQ-4 methane sensors) publishes readings every 30 seconds over MQTT to a FastAPI backend that:

1. **Persists** time-series data (InfluxDB) and digital-twin asset profiles (MongoDB Atlas).
2. **Forecasts** water level 2 hours ahead with an **ARIMAX(2,1,2)** model using OpenWeatherMap rainfall as an exogenous input.
3. **Classifies** flood risk, time-to-flood, recovery time, and anomalies with ML models.
4. **Evaluates** sewer safety from methane levels → deterministic worker-entry clearance.
5. **Alerts** via Sarvam AI (Telugu/Tamil TTS + translation), Twilio (SMS/voice), and Telegram — orchestrated by an **n8n** workflow.
6. **Explains** every prediction with **Gemini**-powered situational briefings, root-cause analysis, and an AI copilot.
7. **Visualizes** everything live in a React Municipal Command Center (D3 animations, Recharts forecasts, Leaflet heat map).

---

## 🏗️ Architecture

```
ESP32 + JSN-SR04T + MQ-4 ──MQTT──► Mosquitto Broker ──► FastAPI Backend (Orchestrator)
                                                              │
        ┌──────────────┬──────────────┬──────────────┬───────┴────────┐
        ▼              ▼              ▼              ▼                ▼
    InfluxDB     MongoDB Atlas   ARIMAX +        APScheduler        n8n
  (time-series) (digital twin)   ML models      (retrain/eval)   (automation)
        │              │              │              │
        └──────────────┴──────────────┴──────────────┘
                              │
        ┌──────────┬──────────┼──────────┬───────────┐
        ▼          ▼          ▼          ▼           ▼
    Sarvam AI  OpenWeather  Gemini AI   Twilio     Telegram
   (TTS/trans) (rainfall)  (briefing)  (SMS/voice) (alerts)
                              │
                       WebSocket feed
                              │
                     React Dashboard
        (Command Center · Digital Twin · Heat Map · AI Copilot)
```

A full diagram is in [`hydromind_full_architecture.svg`](hydromind_full_architecture.svg).

---

## ✨ Key Features (42 total)

| Category | Highlights |
|---|---|
| **Flood Intelligence** | Time-to-flood, escalation forecast, severity timeline, ML risk classification, impact score, recovery prediction |
| **Drainage Intelligence** | Fill %, stress index, health score, capacity utilization, anomaly detection, asset prioritization, criticality score |
| **Sewer Safety** | Sewer Safety Index, worker-entry clearance, methane hazard detection |
| **City Intelligence** | Urban risk score, community preparedness, resilience index, infrastructure criticality |
| **GenAI (Gemini)** | AI flood analyst, explainable AI, root-cause analysis, decision assistant, incident report generator |
| **Automation** | Automated alert engine, n8n autonomous workflow |
| **Multilingual** | Telugu / Tamil / English text + voice alerts (Sarvam AI) |
| **Analytics** | Flood memory layer, incident center, historical trends, model evaluation dashboard |
| **Visualization** | Municipal Command Center, digital-twin dashboard, flood heat map, replay timeline, what-if simulator |

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Edge / IoT** | ESP32 (MicroPython), JSN-SR04T ultrasonic, MQ-4 methane, MQTT |
| **Broker** | Eclipse Mosquitto |
| **Backend** | FastAPI, paho-mqtt, APScheduler, WebSockets |
| **Databases** | InfluxDB (time-series), MongoDB Atlas (assets + incidents) |
| **ML / Forecast** | statsmodels (ARIMAX), scikit-learn / XGBoost (classifiers) |
| **GenAI** | Google Gemini (`gemini-2.5-flash`), Sarvam AI (Indian-language TTS/translate) |
| **Comms** | Twilio (SMS/voice), Telegram Bot API, n8n |
| **Frontend** | React + Vite + TypeScript, D3, Recharts, Leaflet |
| **Infra** | Docker Compose, Nginx, Vultr |

---

## 📁 Repository Structure

```
├── firmware/        # ESP32 MicroPython (sensors) + MQTT simulator
├── broker/          # Mosquitto config
├── backend/         # FastAPI app — routers, services, scheduler, MQTT, WS
│   ├── routers/     # REST: readings, forecast, alerts, drains, chat, …
│   └── services/    # influx, mongo, forecaster, classifier, gemini, sarvam, …
├── sentinel/        # ML pipeline (features, live engine, model validation)
├── frontend/        # React + Vite dashboard
├── n8n/             # Exported automation workflow
├── infra/           # docker-compose.yml, nginx.conf, DEPLOY.md
├── data/            # Chennai rainfall + synthetic drain profiles
├── models/          # Trained model artifacts + metrics
└── tests/           # pytest suite
```

---

## 🚀 Getting Started

### Prerequisites
- **Docker Desktop** (WSL2 backend on Windows) — runs InfluxDB, Mosquitto, n8n
- **Python 3.11+** and **Node.js 18+** (for local backend/frontend dev)
- A **MongoDB Atlas** connection string
- API keys: **Gemini**, **Sarvam AI**, **OpenWeatherMap** (Twilio/Telegram optional — handled in n8n)

### 1. Clone & configure
```bash
git clone https://github.com/aadityaa0523/Team-CONGNIVISTA.git
cd Team-CONGNIVISTA
cp .env.example .env        # then fill in your keys (see table below)
```

### 2. Start the infrastructure (Docker)
```bash
# from the repo root — brings up InfluxDB + Mosquitto + n8n
docker compose -f infra/docker-compose.yml --env-file .env up -d influxdb mosquitto n8n
```

### 3. Run the backend
```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
# API docs at http://localhost:8000/docs
```

### 4. Run the dashboard
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### 5. Stream live data (no hardware required)
```bash
# accelerated demo: watch YELLOW → ORANGE → RED alerts fire in real time
python firmware/simulator/simulate.py --flood-demo
```

### Full-stack one-command run
```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
# backend :8000 · frontend :80 · n8n :5678 · influxdb :8086 · mosquitto :1883
```

---

## 🌍 Production Deployment (Vultr)

See [`infra/DEPLOY.md`](infra/DEPLOY.md) for the full walkthrough. Summary:

1. Provision a Vultr VPS (Ubuntu 22.04, 2 vCPU / 4 GB RAM).
2. Install Docker + Compose, `git clone`, copy your `.env`.
3. `docker compose -f infra/docker-compose.yml --env-file .env up -d --build`.
4. Point a domain at the VPS IP; run **Certbot** for TLS.
5. Flash ESP32 firmware with `MQTT_BROKER_HOST=<your-domain>`, port `8883` (TLS).
6. Verify end-to-end: sensor → broker → backend → dashboard → Telegram alert.

---

## 🔑 Environment Variables

Copy `.env.example` → `.env` and fill in:

| Variable | Purpose |
|---|---|
| `MONGO_URI`, `MONGO_DB` | MongoDB Atlas connection |
| `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET` | Time-series DB |
| `MQTT_BROKER_HOST`, `MQTT_BROKER_PORT`, `MQTT_TOPIC` | Broker |
| `GEMINI_API_KEY` | AI briefings, XAI, copilot |
| `SARVAM_API_KEY` | Telugu/Tamil TTS + translation |
| `OWM_API_KEY` | Rainfall (ARIMAX exogenous input) |
| `TWILIO_*`, `TELEGRAM_*` | SMS / voice / Telegram (optional — n8n can own these) |
| `ALERT_*_CM`, `DRAIN_*_PCT`, `METHANE_*_PPM` | Alert thresholds |

> ⚠️ **Never commit `.env`** — it is gitignored. Share secrets with teammates out-of-band.

---

## 🧪 Testing

```bash
pytest -q          # full suite (44+ tests)
```

---

## 🏆 Hackathon Tracks

- **IoT** — low-cost ESP32 edge nodes + MQTT + digital twin of physical drainage. See [PITCH.md](PITCH.md#-iot-fit).
- **Sustainable Development** — flood resilience, clean water/sanitation, climate adaptation, worker safety. See [PITCH.md](PITCH.md#-sustainable-development-fit).

---

## 👥 Team CONGNIVISTA

Built for a hackathon to make Indian cities flood-resilient — one drain at a time.

*HydroMind Sentinel is not a flood dashboard. It is an AI-powered Urban Drainage Digital Twin and Sewer Safety Intelligence Platform.*
