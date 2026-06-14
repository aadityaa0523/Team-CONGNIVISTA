# Device configuration — edit before flashing each node
NODE_ID       = "krishna_river_01"          # unique per physical device
MQTT_HOST     = "10.123.210.135"             # broker IP (your laptop on local network)
MQTT_PORT     = 1883
MQTT_TOPIC    = "hydromind/waterlevel/" + NODE_ID
TRIG_PIN      = 5                        # GPIO18 on ESP32 DevKit-C
ECHO_PIN      = 34                       # GPIO19 on ESP32 DevKit-C
READ_INTERVAL = 5                       # seconds between sensor reads
BUFFER_MAX    = 5                           # readings held in RAM during outage
