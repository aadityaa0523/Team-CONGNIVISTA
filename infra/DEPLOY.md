# HydroMind — Vultr Deployment (Phase 10)

End-to-end: physical sensor → Vultr Mosquitto (TLS) → FastAPI backend → React dashboard.

## Stack

| Service    | Image / Build         | Port(s)        | Notes                                  |
|------------|-----------------------|----------------|----------------------------------------|
| influxdb   | `influxdb:2.7`        | 8086           | Time-series readings                   |
| mosquitto  | `eclipse-mosquitto:2` | 1883, 8883     | 1883 internal, 8883 TLS for ESP32      |
| backend    | `backend/Dockerfile`  | 8000           | FastAPI + MQTT + ARIMAX + scheduler    |
| n8n        | `n8nio/n8n`           | 5678           | Alert automation workflow (Phase 8)    |
| frontend   | `frontend/Dockerfile` | 80 (443 w/TLS) | nginx serving React + API/WS proxy     |

MongoDB is **external** (Atlas) via `MONGO_URI` — not a container.

---

## 1. Provision the VPS

- Vultr Cloud Compute, **Ubuntu 22.04**, **2 vCPU / 4 GB RAM** minimum.
- Open firewall ports: `22` (SSH), `80`, `443`, `8883` (MQTT TLS), and `8086` only if you need remote Influx access.

## 2. Install Docker + Compose

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
docker compose version   # verify Compose v2
```

## 3. Clone & configure

```bash
git clone <your-repo-url> hydromind && cd hydromind
cp .env.example .env
nano .env   # fill MONGO_URI, OWM/SARVAM/GEMINI/TWILIO keys, set INFLUX_TOKEN
```

> **INFLUX_TOKEN** must be set (the compose file uses it for *both* the DB's
> init admin token and the backend), and **INFLUX_PASSWORD** ≥ 8 chars.

## 4. Build & launch

Run from the **repo root** (build contexts and `.env` resolve from there):

```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs -f backend
```

Smoke test:

```bash
curl http://localhost:8000/health          # {"status":"ok"}
curl http://localhost/health               # proxied through nginx
```

Open `http://<VPS_IP>/` — the dashboard should load and the WS status chip should read **open**.

## 4b. Import the n8n automation workflow (Phase 8)

1. Open `http://<VPS_IP>:5678` and log in (`N8N_USER` / `N8N_PASSWORD`).
2. **Import from File** → select `n8n/hydromind_workflow.json` (mounted at `/workflows` in the container).
3. Attach credentials on the HTTP/MongoDB nodes (Gemini key, MongoDB URI).
4. **Activate** the workflow, copy its **Production webhook URL**, and set `N8N_WEBHOOK_URL` in `.env`.
5. Restart the backend so `alert_engine._fire_n8n` picks up the URL:
   `docker compose -f infra/docker-compose.yml up -d backend`

## 5. Point a domain + TLS (HTTPS for the dashboard)

DNS: create an `A` record for your domain → VPS IP.

The simplest path is a host-level Certbot in front, but since nginx runs in the
`frontend` container, use a webroot challenge:

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d yourdomain.com   # stop :80 briefly or use webroot
```

Then mount the certs into the frontend container and add a `443` server block to
`infra/nginx.conf` (uncomment the `443` port mapping in compose). Reload:

```bash
docker compose -f infra/docker-compose.yml restart frontend
```

## 6. MQTT over TLS (8883) for field ESP32 nodes

Generate certs (Let's Encrypt for the broker hostname, or a self-signed CA for
device certs), then place them in `broker/certs/`:

```
broker/certs/ca.crt
broker/certs/server.crt
broker/certs/server.key
```

- Uncomment the `listener 8883` block in [broker/mosquitto.conf](../broker/mosquitto.conf).
- Uncomment the `../broker/certs:/mosquitto/certs:ro` volume in the compose `mosquitto` service.
- `docker compose -f infra/docker-compose.yml up -d mosquitto`

## 7. Update ESP32 firmware

Point nodes at the broker:

- `MQTT_BROKER_HOST` = your VPS domain
- `MQTT_BROKER_PORT` = `8883`
- Enable TLS in the firmware (load CA cert).

## 8. Verify end-to-end

1. Power a sensor node → it publishes to `hydromind/waterlevel/<node_id>`.
2. `docker compose ... logs -f backend` shows the reading ingested + written to Influx.
3. Dashboard water level animates live; train a model via the **Train Model** button.
4. Submerge the sensor below a threshold → alert fires (SMS in Telugu via Twilio/Sarvam).

---

## Operations

```bash
# Tail all logs
docker compose -f infra/docker-compose.yml logs -f

# Rebuild after a code change
docker compose -f infra/docker-compose.yml up -d --build backend frontend

# Stop / start
docker compose -f infra/docker-compose.yml down
docker compose -f infra/docker-compose.yml up -d

# Full reset (DELETES Influx + model volumes)
docker compose -f infra/docker-compose.yml down -v
```

Trained models persist in the `backend_models` volume across restarts; readings
persist in `influxdb_data`.
