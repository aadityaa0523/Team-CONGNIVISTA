import { useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { LatLngExpression, LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Drain } from "../types";
import { riskScoreColor } from "../levels";

interface Props {
  drains: Drain[];
  onSelect?: (drainId: string) => void;
}

// Default view centred on Chennai (urban-drain focus) when no coords exist.
const FALLBACK_CENTER: LatLngExpression = [13.0827, 80.2707];

export default function FloodHeatMap({ drains, onSelect }: Props) {
  const located = useMemo(
    () =>
      drains.filter(
        (d) => d.location && typeof d.location.lat === "number" && typeof d.location.lon === "number",
      ),
    [drains],
  );

  const bounds = useMemo<LatLngBoundsExpression | undefined>(() => {
    if (located.length < 2) return undefined;
    return located.map((d) => [d.location!.lat, d.location!.lon] as [number, number]);
  }, [located]);

  const center: LatLngExpression =
    located.length === 1
      ? [located[0].location!.lat, located[0].location!.lon]
      : FALLBACK_CENTER;

  return (
    <div className="map-card">
      <div className="map-header">
        <h3>Flood Risk Heat Map</h3>
        <span className="map-sub">{located.length} drains · color = urban risk</span>
      </div>
      <div className="map-wrap">
        <MapContainer
          center={center}
          bounds={bounds}
          zoom={11}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%", borderRadius: 10 }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {located.map((d) => {
            const risk = d.risk_score ?? 0;
            const color = riskScoreColor(risk);
            return (
              <CircleMarker
                key={d.drain_id}
                center={[d.location!.lat, d.location!.lon]}
                radius={10 + risk / 12}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.6, weight: 2 }}
                eventHandlers={{ click: () => onSelect?.(d.drain_id) }}
              >
                <Popup>
                  <strong>{d.name ?? d.drain_id}</strong>
                  <br />
                  Risk: {risk} · Fill: {d.fill_pct ?? "—"}%
                  <br />
                  Health: {d.health_label ?? d.health_score ?? "—"}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
        {located.length === 0 && (
          <div className="map-empty">No geolocated drains yet. Add drain profiles with coordinates.</div>
        )}
      </div>
    </div>
  );
}
