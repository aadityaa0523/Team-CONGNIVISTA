"""
HydroMind Methane Simulator
Publishes simulated MQ-4 methane readings for nodes that have real water-level
hardware but no physical gas sensor.

Usage:
  python firmware/simulator/simulate_methane.py
  python firmware/simulator/simulate_methane.py --nodes krishna_river_01,D001
  python firmware/simulator/simulate_methane.py --hazard-demo   # spikes into DANGER/CRITICAL
"""

import argparse
import json
import math
import random
import time

import paho.mqtt.client as mqtt


# ── Methane level generation ──────────────────────────────────────────────────

def _base_methane(t: float, phase: float) -> float:
    """Slow background variation 50–150 ppm, well below CAUTION (200 ppm)."""
    period = 20 * 60  # 20-minute cycle
    return 100.0 + 50.0 * math.sin(2 * math.pi * (t + phase) / period)


def _hazard_spike(t: float, cycle_s: float) -> float:
    """Periodic spike up to 900 ppm over cycle_s seconds (sine-shaped)."""
    phase = (t % cycle_s) / cycle_s
    return 900.0 * max(0.0, math.sin(math.pi * phase))


def generate_methane(node_id: str, t: float, phase: float, hazard_cycle_s: float) -> dict:
    base = _base_methane(t, phase)
    spike = _hazard_spike(t, hazard_cycle_s)
    noise = random.gauss(0, 5.0)
    ppm = max(0.0, round(base + spike + noise, 1))
    return {
        "node_id": node_id,
        "methane_ppm": ppm,
        "ts": int(time.time() * 1000),
    }


def _level_label(ppm: float) -> str:
    if ppm >= 1000:
        return "[CRITICAL]"
    if ppm >= 500:
        return "[DANGER]"
    if ppm >= 200:
        return "[CAUTION]"
    return "[safe]"


# ── MQTT ─────────────────────────────────────────────────────────────────────

def build_client(broker: str, port: int) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="hydromind-methane-sim")
    client.on_connect = lambda c, ud, f, rc, props: print(f"[MQTT] connected (rc={rc})")
    client.on_disconnect = lambda c, ud, dc, rc, props: print(f"[MQTT] disconnected (rc={rc})")
    client.connect(broker, port, keepalive=60)
    client.loop_start()
    return client


def publish(client: mqtt.Client, reading: dict) -> None:
    topic = f"hydromind/methane/{reading['node_id']}"
    client.publish(topic, json.dumps(reading), qos=1)
    label = _level_label(reading["methane_ppm"])
    print(f"  [{reading['node_id']}] {reading['methane_ppm']:7.1f} ppm  {label}")


# ── Entry point ───────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="HydroMind Methane Simulator")
    p.add_argument("--broker", default="localhost")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--nodes", default="krishna_river_01,godavari_river_01")
    p.add_argument("--interval", type=float, default=30.0)
    p.add_argument(
        "--hazard-demo",
        action="store_true",
        help="Accelerated demo: interval=5s, hazard spike every 2 min into DANGER/CRITICAL.",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    node_ids = [n.strip() for n in args.nodes.split(",") if n.strip()]
    interval = 5.0 if args.hazard_demo else args.interval
    hazard_cycle_s = 120.0 if args.hazard_demo else 3600.0

    print("HydroMind Methane Simulator")
    print(f"  broker  : {args.broker}:{args.port}")
    print(f"  nodes   : {node_ids}")
    print(f"  interval: {interval} s")
    print(f"  hazard  : {'DEMO (2-min spike cycle)' if args.hazard_demo else 'normal (1-hr cycle)'}")
    print()

    client = build_client(args.broker, args.port)
    time.sleep(1)

    phase_offsets = {nid: i * (hazard_cycle_s / max(len(node_ids), 1))
                     for i, nid in enumerate(node_ids)}
    t0 = time.time()
    try:
        while True:
            t = time.time() - t0
            for node_id in node_ids:
                reading = generate_methane(node_id, t, phase_offsets[node_id], hazard_cycle_s)
                publish(client, reading)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nSimulator stopped.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
