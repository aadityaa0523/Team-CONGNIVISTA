import asyncio, sys, pandas as pd
sys.path.insert(0, '.')

async def main():
    from backend.services import alert_engine, influx

    # Stub all InfluxDB calls so we don't need it running
    influx.get_latest          = lambda node_id: 25.0          # RED (below 40 cm threshold)
    influx.get_latest_methane  = lambda node_id: 0.0
    influx.query_readings      = lambda node_id, hours=6: pd.DataFrame(
        {"time": pd.date_range("now", periods=5, freq="30s"), "distance_cm": [30.0]*5}
    )

    # Clear debounce so alert fires fresh
    alert_engine._last_alert.clear()

    await alert_engine.evaluate('krishna_river_01')
    print('Alert pipeline done — check phone for SMS and call.')

asyncio.run(main())
