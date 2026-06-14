"""
End-to-end Phase 3 smoke test.
Verifies: MQTT publish -> FastAPI backend -> WebSocket broadcast.

Run from repo root:
  python tests/_e2e_phase3.py
"""
import asyncio
import json
import os
import subprocess
import sys
import threading
import time

import paho.mqtt.client as mqtt
import websockets
from amqtt.broker import Broker

BROKER_PORT = 1883
API_PORT = 8001

BROKER_CONFIG = {
    "listeners": {"default": {"type": "tcp", "bind": f"127.0.0.1:{BROKER_PORT}"}},
    "sys_interval": 0,
    "auth": {"allow-anonymous": True},
    "topic-check": {"enabled": False},
}

TEST_NODE = "e2e_test_node"
TEST_PAYLOAD = {
    "node_id": TEST_NODE,
    "distance_cm": 55.0,
    "ts": int(time.time() * 1000),
}


def _publish():
    """Publish one reading from a background thread (called after WS connects)."""
    time.sleep(0.5)
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, "e2e-publisher")
    c.connect("127.0.0.1", BROKER_PORT)
    c.publish(f"hydromind/waterlevel/{TEST_NODE}", json.dumps(TEST_PAYLOAD))
    time.sleep(0.2)
    c.disconnect()
    print("[sim] published")


async def run() -> bool:
    # 1. In-process MQTT broker
    broker = Broker(BROKER_CONFIG)
    await broker.start()
    print("[broker] started on", BROKER_PORT)

    # 2. FastAPI subprocess
    env = {**os.environ, "PYTHONPATH": "."}
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    srv = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--port", str(API_PORT), "--log-level", "warning"],
        env=env,
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    time.sleep(3.5)  # let uvicorn start + paho connect + subscribe

    # 3. Connect WS, then publish — ensures broadcast hits a live client
    passed = False
    try:
        async with websockets.connect(
            f"ws://localhost:{API_PORT}/ws", open_timeout=5
        ) as ws:
            print("[ws] connected — triggering publish")
            threading.Thread(target=_publish, daemon=True).start()
            raw = await asyncio.wait_for(ws.recv(), timeout=8)
            data = json.loads(raw)
            assert data["node_id"] == TEST_PAYLOAD["node_id"]
            assert data["distance_cm"] == TEST_PAYLOAD["distance_cm"]
            assert len(str(data["ts"])) == 13
            print("[ws] payload validated:", data)
            passed = True
    except Exception as e:
        print("[ws] FAILED:", e)
        srv.kill()
        out, _ = srv.communicate()
        print("--- backend logs (last 15 lines) ---")
        for line in out.splitlines()[-15:]:
            print(line)

    srv.kill()
    await broker.shutdown()
    return passed


if __name__ == "__main__":
    ok = asyncio.run(run())
    print("\nEND-TO-END:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
