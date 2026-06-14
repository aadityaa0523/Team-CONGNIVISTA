# Implemented in Phase 3
# Tests for backend.mqtt_client:
#   - Valid payload is parsed and written to InfluxDB
#   - Malformed JSON is logged and discarded without crashing
#   - WebSocket manager receives broadcast within 2 s of MQTT publish
