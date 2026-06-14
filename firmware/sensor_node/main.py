import machine
import time
import network
import ujson

import config
import secrets

# MicroPython epoch is 2000-01-01; Unix epoch is 1970-01-01 (difference = 946684800 s)
_EPOCH_OFFSET = 946684800

wlan = network.WLAN(network.STA_IF)
_time_synced = False


# ── Section 1: Sensor ─────────────────────────────────────────────────────────

_trig = machine.Pin(config.TRIG_PIN, machine.Pin.OUT)
_echo = machine.Pin(config.ECHO_PIN, machine.Pin.IN)

def measure_distance():
    """Return distance in cm from sensor to water surface, or None on error."""
    _trig.off()
    time.sleep_us(2)
    _trig.on()
    time.sleep_us(10)
    _trig.off()

    # Wait for echo to go HIGH (with 30 ms timeout)
    t0 = time.ticks_us()
    while _echo.value() == 0:
        if time.ticks_diff(time.ticks_us(), t0) > 30_000:
            return None

    t_start = time.ticks_us()

    # Wait for echo to go LOW (with 30 ms timeout)
    while _echo.value() == 1:
        if time.ticks_diff(time.ticks_us(), t_start) > 30_000:
            return None

    t_end = time.ticks_us()
    duration_us = time.ticks_diff(t_end, t_start)
    distance = (duration_us * 0.0343) / 2.0

    if 20.0 <= distance <= 450.0:
        return round(distance, 1)
    return None


# ── Section 2: WiFi ───────────────────────────────────────────────────────────

def ensure_wifi(timeout_ms=15_000):
    """Connect to WiFi if not already connected. Returns True on success."""
    if wlan.isconnected():
        return True

    # Only reset radio if not already active
    try:
        wlan.active(False)
        time.sleep_ms(500)
        wlan.active(True)
        time.sleep_ms(500)
    except Exception as e:
        print("WiFi reset error:", e)

    print("Connecting to WiFi:", secrets.SSID)
    try:
        wlan.connect(secrets.SSID, secrets.PASSWORD)
    except Exception as e:
        print("WiFi connect error:", e)
        return False

    t0 = time.ticks_ms()
    while not wlan.isconnected():
        if time.ticks_diff(time.ticks_ms(), t0) > timeout_ms:
            print("WiFi timeout")
            return False
        time.sleep_ms(200)
    print("WiFi connected:", wlan.ifconfig()[0])
    return True


# ── Section 3: NTP ────────────────────────────────────────────────────────────

def sync_time():
    """Sync RTC once via NTP. Skipped silently if WiFi is unavailable."""
    global _time_synced
    if _time_synced:
        return
    try:
        import ntptime
        ntptime.settime()
        _time_synced = True
        print("NTP synced")
    except Exception as e:
        print("NTP sync failed:", e)


def epoch_ms():
    """Current time as Unix epoch milliseconds."""
    return (time.time() + _EPOCH_OFFSET) * 1000


# ── Section 4: MQTT ───────────────────────────────────────────────────────────

def make_client():
    from umqtt.robust import MQTTClient
    return MQTTClient(config.NODE_ID, config.MQTT_HOST, config.MQTT_PORT)

_client = None

def get_client():
    global _client
    if _client is None:
        _client = make_client()
        _client.connect()
    return _client


# ── Section 5: Main loop ──────────────────────────────────────────────────────

def main():
    buffer = []  # holds dicts; capped at BUFFER_MAX

    # Initial WiFi + NTP
    if ensure_wifi():
        sync_time()

    while True:
        distance = measure_distance()
        print("Sensor reading:", distance, "cm" if distance else "(no echo — check wiring)")
        if distance is not None:
            reading = {
                "node_id": config.NODE_ID,
                "distance_cm": distance,
                "ts": int(epoch_ms()),
            }
            buffer.append(reading)
            if len(buffer) > config.BUFFER_MAX:
                buffer.pop(0)  # drop oldest

        if buffer and ensure_wifi():
            sync_time()
            try:
                client = get_client()
                client.check_msg()  # umqtt.robust reconnects internally if needed
                for r in buffer:
                    client.publish(config.MQTT_TOPIC, ujson.dumps(r))
                    print("Published:", r["distance_cm"], "cm @", r["ts"])
                buffer.clear()
            except Exception as e:
                print("MQTT error:", e)
                global _client
                _client = None  # force reconnect next iteration

        time.sleep(config.READ_INTERVAL)


main()
