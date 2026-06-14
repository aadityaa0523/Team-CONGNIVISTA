import logging

import pandas as pd
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from backend.config import settings

logger = logging.getLogger(__name__)

_client = InfluxDBClient(
    url=settings.influx_url,
    token=settings.influx_token,
    org=settings.influx_org,
)
_write_api = _client.write_api(write_options=SYNCHRONOUS)
_query_api = _client.query_api()


def write_reading(node_id: str, distance_cm: float, ts: int) -> None:
    """Write one sensor reading. ts is Unix epoch milliseconds."""
    point = (
        Point("water_level")
        .tag("node_id", node_id)
        .field("distance_cm", float(distance_cm))
        .time(ts, WritePrecision.MS)
    )
    _write_api.write(bucket=settings.influx_bucket, record=point)


def query_readings(node_id: str, hours: int = 6) -> pd.DataFrame:
    """Return DataFrame[time, distance_cm] for the given node over the past N hours."""
    flux = f"""
from(bucket: "{settings.influx_bucket}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) =>
      r._measurement == "water_level" and
      r.node_id == "{node_id}" and
      r._field == "distance_cm")
  |> sort(columns: ["_time"])
"""
    tables = _query_api.query(flux)
    records = [
        {"time": rec.get_time(), "distance_cm": rec.get_value()}
        for table in tables
        for rec in table.records
    ]
    return pd.DataFrame(records, columns=["time", "distance_cm"]) if records else pd.DataFrame(columns=["time", "distance_cm"])


def get_latest(node_id: str) -> float | None:
    """Return the most recent distance_cm for the node, or None if no data."""
    flux = f"""
from(bucket: "{settings.influx_bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) =>
      r._measurement == "water_level" and
      r.node_id == "{node_id}" and
      r._field == "distance_cm")
  |> last()
"""
    tables = _query_api.query(flux)
    for table in tables:
        for rec in table.records:
            return float(rec.get_value())
    return None


# ── Methane (MQ-4) ────────────────────────────────────────────────────────────

def write_methane(node_id: str, methane_ppm: float, ts: int) -> None:
    """Write one MQ-4 methane reading. ts is Unix epoch milliseconds."""
    point = (
        Point("methane")
        .tag("node_id", node_id)
        .field("methane_ppm", float(methane_ppm))
        .time(ts, WritePrecision.MS)
    )
    _write_api.write(bucket=settings.influx_bucket, record=point)


def query_methane(node_id: str, hours: int = 1) -> pd.DataFrame:
    """Return DataFrame[time, methane_ppm] for the given node over the past N hours."""
    flux = f"""
from(bucket: "{settings.influx_bucket}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) =>
      r._measurement == "methane" and
      r.node_id == "{node_id}" and
      r._field == "methane_ppm")
  |> sort(columns: ["_time"])
"""
    tables = _query_api.query(flux)
    records = [
        {"time": rec.get_time(), "methane_ppm": rec.get_value()}
        for table in tables
        for rec in table.records
    ]
    return (
        pd.DataFrame(records, columns=["time", "methane_ppm"])
        if records
        else pd.DataFrame(columns=["time", "methane_ppm"])
    )


def get_latest_methane(node_id: str) -> float | None:
    """Return the most recent methane_ppm for the node, or None if no data."""
    flux = f"""
from(bucket: "{settings.influx_bucket}")
  |> range(start: -1h)
  |> filter(fn: (r) =>
      r._measurement == "methane" and
      r.node_id == "{node_id}" and
      r._field == "methane_ppm")
  |> last()
"""
    tables = _query_api.query(flux)
    for table in tables:
        for rec in table.records:
            return float(rec.get_value())
    return None
