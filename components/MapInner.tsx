"use client";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useSubwayRoutes } from "@/hooks/useSubwayRoutes";
import { useSubwayStations } from "@/hooks/useSubwayStations";
import SubwayLayer from "@/components/SubwayLayer";
import StationLayer from "@/components/StationLayer";

export const DC_CENTER: [number, number] = [38.9072, -77.0369];
export const DEFAULT_ZOOM = 12;

export const TILE_URL =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
export const TILE_SUBDOMAINS = "abcd";
export const TILE_MAX_ZOOM = 20;

export default function MapInner() {
  const { routes, loading, error } = useSubwayRoutes();
  const { stations, loading: stationsLoading, error: stationsError } = useSubwayStations();

  const anyLoading = loading || stationsLoading;

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <MapContainer
        center={DC_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        data-testid="map-container"
      >
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL}
          subdomains={TILE_SUBDOMAINS}
          maxZoom={TILE_MAX_ZOOM}
        />
        <SubwayLayer routes={routes} />
        <StationLayer stations={stations} />
      </MapContainer>

      {anyLoading && (
        <div
          data-testid="subway-loading"
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "rgba(255,255,255,0.92)",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          Loading Metro data…
        </div>
      )}

      {error && (
        <div
          data-testid="subway-error"
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "rgba(255,240,240,0.95)",
            color: "#c00",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          Could not load Metro lines
        </div>
      )}

      {stationsError && !error && (
        <div
          data-testid="stations-error"
          style={{
            position: "absolute",
            bottom: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "rgba(255,240,240,0.95)",
            color: "#c00",
            padding: "6px 14px",
            borderRadius: 20,
            fontSize: 13,
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          Could not load station markers
        </div>
      )}
    </div>
  );
}
