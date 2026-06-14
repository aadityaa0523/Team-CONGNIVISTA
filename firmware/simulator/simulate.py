"""
HydroMind MQTT Simulator
Emits the same JSON payload as the ESP32 firmware so the backend can be
tested without physical hardware.

Usage:
  python firmware/simulator/simulate.py --nodes krishna_river_01,godavari_river_01
  python firmware/simulator/simulate.py --flood-demo   # accelerated alert scenario
"""

import argparse
import json
import math
import random
import sys
import time

import paho.mqtt.client as mqtt


# ── Data model ────────────────────────────────────────────────────────────────

def _base_level(t: float, phase_offset: float = 0.0) -> float:
    """
    Slow sinusoidal 'river rhythm' centred at 120 cm, ±30 cm over 12 hours.
    Lower distance_cm = water is closer to sensor = higher water level.
    """
    period = 12 * 3600  # 12-hour cycle
    return 120.0 + 30.0 * math.sin(2 * math.pi * (t + phase_offset) / period)


def _flood_drop(t: float, cycle_s: float) -> float:
    """
    Periodic flood event: sine-shaped drop of up to 70 cm over `cycle_s` seconds,
    then recovery. Triggers once per cycle.
    """
    phase = (t % cycle_s) / cycle_s  # 0 → 1
    return 85.0 * max(0.0, math.sin(math.pi * phase))


def generate_reading(node_id: str, t: float, phase_offset: float, flood_cycle_s: float) -> dict:
    base = _base_level(t, phase_offset)
    drop = _flood_drop(t, flood_cycle_s)
    noise = random.gauss(0, 2.0)
    distance = max(20.0, min(450.0, base - drop + noise))
    return {
        "node_id": node_id,
        "distance_cm": round(distance, 1),
        "ts": int(time.time() * 1000),
    }


# ── MQTT helpers ──────────────────────────────────────────────────────────────

def build_client(broker: str, port: int) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="hydromind-simulator")
    client.on_connect = lambda c, ud, f, rc, props: print(f"[MQTT] connected (rc={rc})")
    client.on_disconnect = lambda c, ud, dc, rc, props: print(f"[MQTT] disconnected (rc={rc})")
    client.connect(broker, port, keepalive=60)
    client.loop_start()
    return client


def publish(client: mqtt.Client, reading: dict) -> None:
    topic = f"hydromind/waterlevel/{reading['node_id']}"
    payload = json.dumps(reading)
    result = client.publish(topic, payload, qos=1)
    result.wait_for_publish()
    level_hint = _level_label(reading["distance_cm"])
    print(f"  [{reading['node_id']}] {reading['distance_cm']:6.1f} cm  {level_hint}  ts={reading['ts']}")


def _level_label(distance_cm: float) -> str:
    if distance_cm <= 40:
        return "[RED]"
    if distance_cm <= 60:
        return "[ORANGE]"
    if distance_cm <= 80:
        return "[YELLOW]"
    return "[safe]"


# ── Entry point ───────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="HydroMind MQTT Simulator")
    p.add_argument("--broker", default="localhost", help="MQTT broker host (default: localhost)")
    p.add_argument("--port", type=int, default=1883, help="MQTT broker port (default: 1883)")
    p.add_argument(
        "--nodes",
        default="krishna_river_01,godavari_river_01",
        help="Comma-separated node IDs",
    )
    p.add_argument(
        "--interval",
        type=float,
        default=30.0,
        help="Seconds between readings per node (default: 30)",
    )
    p.add_argument(
        "--flood-demo",
        action="store_true",
        help=(
            "Accelerated demo mode: interval → 5 s, flood cycle → 2 min. "
            "Watch YELLOW → ORANGE → RED fire in real time."
        ),
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    node_ids = [n.strip() for n in args.nodes.split(",") if n.strip()]
    interval = 5.0 if args.flood_demo else args.interval
    flood_cycle_s = 120.0 if args.flood_demo else 600.0  # 2 min demo vs 10 min normal

    print(f"HydroMind Simulator")
    print(f"  broker   : {args.broker}:{args.port}")
    print(f"  nodes    : {node_ids}")
    print(f"  interval : {interval} s")
    print(f"  flood    : {'DEMO (2-min cycle)' if args.flood_demo else 'normal (10-min cycle)'}")
    print()

    client = build_client(args.broker, args.port)
    time.sleep(1)  # let connection establish

    # Give each node a phase offset so alerts don't fire simultaneously
    phase_offsets = {nid: i * (flood_cycle_s / len(node_ids)) for i, nid in enumerate(node_ids)}

    t0 = time.time()
    try:
        while True:
            t = time.time() - t0
            for node_id in node_ids:
                reading = generate_reading(node_id, t, phase_offsets[node_id], flood_cycle_s)
                publish(client, reading)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nSimulator stopped.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
