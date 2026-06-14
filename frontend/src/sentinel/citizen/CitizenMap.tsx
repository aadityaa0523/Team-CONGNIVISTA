import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

import type { RiskClass } from "../../types";
import {
  RELIEF_CENTERS,
  SAFE_ZONES,
  riskMeta,
  type MonitoredArea,
} from "../data";
import type { CommunityReport } from "../../api";

interface Props {
  areas: MonitoredArea[];
  areaRisk: Record<string, RiskClass>;
  userPos: { lat: number; lng: number } | null;
  reports: CommunityReport[];
  routeTo?: { lat: number; lng: number } | null;
  focusArea?: MonitoredArea;
}

const userIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#1763b3;border:3px solid #fff;box-shadow:0 0 0 5px rgba(23,99,179,.28)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Flies to the user's GPS position the first time it becomes available.
// Subsequently flies to the selected area node only if the user manually
// changes the dropdown (not on every render).
function MapController({
  userPos,
  focusArea,
}: {
  userPos: { lat: number; lng: number } | null;
  focusArea?: MonitoredArea;
}) {
  const map = useMap();
  const didFlyToUser = useRef(false);
  const prevAreaId = useRef<string | undefined>(undefined);

  // Priority 1: fly to real GPS position the first time we get it.
  useEffect(() => {
    if (!userPos || didFlyToUser.current) return;
    didFlyToUser.current = true;
    map.flyTo([userPos.lat, userPos.lng], 14, { duration: 1.5 });
  }, [userPos, map]);

  // Priority 2: if the user switches the area dropdown AFTER GPS is already set,
  // fly to the new area centre so they can see it.
  useEffect(() => {
    if (!focusArea) return;
    if (focusArea.id === prevAreaId.current) return;
    prevAreaId.current = focusArea.id;
    // Only fly to area if we haven't gotten GPS yet (GPS takes priority).
    if (!didFlyToUser.current) {
      map.flyTo([focusArea.lat, focusArea.lng], 13, { duration: 1.2 });
    }
  }, [focusArea, map]);

  return null;
}

export default function CitizenMap({ areas, areaRisk, userPos, reports, routeTo, focusArea }: Props) {
  // Initial render center: GPS first, then selected area, then Hyderabad default.
  const initArea = focusArea ?? areas[0];
  const center: LatLngExpression = userPos
    ? [userPos.lat, userPos.lng]
    : initArea
    ? [initArea.lat, initArea.lng]
    : [17.385, 78.488];

  return (
    <div className="map-host">
      <MapContainer center={center} zoom={14} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution="&copy; OpenStreetMap &copy; CARTO"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <MapController userPos={userPos} focusArea={focusArea} />

        {/* Monitored flood-risk zones */}
        {areas.map((a) => {
          const risk = areaRisk[a.id] ?? "SAFE";
          const m = riskMeta(risk);
          return (
            <CircleMarker
              key={a.id}
              center={[a.lat, a.lng]}
              radius={18}
              pathOptions={{ color: m.color, fillColor: m.color, fillOpacity: 0.35, weight: 2 }}
            >
              <Tooltip permanent={false}>{a.name} — {m.label}</Tooltip>
              <Popup>
                <strong>{a.name}</strong><br />
                {a.ward}, {a.city}<br />
                Status: <b style={{ color: m.color }}>{m.label}</b><br />
                Population: {a.population.toLocaleString()}
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Relief centers — blue */}
        {RELIEF_CENTERS.map((rc) => (
          <CircleMarker
            key={rc.id}
            center={[rc.lat, rc.lng]}
            radius={9}
            pathOptions={{ color: "#1763b3", fillColor: "#1763b3", fillOpacity: 0.9, weight: 1 }}
          >
            <Tooltip>🏫 {rc.name}</Tooltip>
            <Popup>
              <strong>{rc.name}</strong><br />
              {rc.type} · Capacity {rc.capacity.toLocaleString()}
            </Popup>
          </CircleMarker>
        ))}

        {/* Safe zones — green */}
        {SAFE_ZONES.map((sz) => (
          <CircleMarker
            key={sz.id}
            center={[sz.lat, sz.lng]}
            radius={10}
            pathOptions={{ color: "#1f9d55", fillColor: "#1f9d55", fillOpacity: 0.85, weight: 1 }}
          >
            <Tooltip>✅ Safe Zone — {sz.name}</Tooltip>
            <Popup>
              <strong>{sz.name}</strong><br />
              Safe Zone · {sz.elevationNote}
            </Popup>
          </CircleMarker>
        ))}

        {/* Community reports — orange */}
        {reports
          .filter((r) => r.lat != null && r.lon != null)
          .map((r) => (
            <CircleMarker
              key={r.id}
              center={[r.lat as number, r.lon as number]}
              radius={7}
              pathOptions={{ color: "#e2680c", fillColor: "#f0801f", fillOpacity: 0.9, weight: 1 }}
            >
              <Popup>
                <strong>{r.type.replace(/_/g, " ")}</strong><br />
                {r.description || "(no description)"}<br />
                {r.area}
              </Popup>
            </CircleMarker>
          ))}

        {/* User's live position — pulsing blue dot */}
        {userPos && (
          <Marker position={[userPos.lat, userPos.lng]} icon={userIcon}>
            <Tooltip permanent>📍 You are here</Tooltip>
          </Marker>
        )}

        {/* Route to nearest safe zone */}
        {userPos && routeTo && (
          <Polyline
            positions={[[userPos.lat, userPos.lng], [routeTo.lat, routeTo.lng]]}
            pathOptions={{ color: "#1f9d55", weight: 4, dashArray: "8 6" }}
          />
        )}
      </MapContainer>
    </div>
  );
}
