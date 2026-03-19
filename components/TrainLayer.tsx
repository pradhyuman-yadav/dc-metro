"use client";
import { useEffect, useRef, type MutableRefObject } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { getTrainLatLng, getTrainSegmentBearing } from "@/lib/simulation";
import type { TrainState, RoutePath } from "@/lib/simulation";

interface TrainLayerProps {
  trainsRef: MutableRefObject<TrainState[]>;
  pathsMap: Map<number, RoutePath>;
}

// ─── Zoom threshold ────────────────────────────────────────────────────────────

/**
 * Trains are hidden below this zoom level.
 * At zoom 10 the map covers most of the DC metro area (~40 km) and individual
 * train symbols would be too small to be meaningful.
 */
export const MIN_TRAIN_ZOOM = 11;

// ─── Colour utilities ──────────────────────────────────────────────────────────

/**
 * Darken a CSS hex colour by multiplying each RGB channel by `factor` (0–1).
 * A factor of 0.60 gives a clearly distinct, darker version of the line colour
 * that is easy to identify against the light map tiles.
 * Handles both 3- and 6-digit hex strings, with or without leading "#".
 */
export function darkenColour(hex: string, factor: number): string {
  const raw = hex.replace("#", "");
  // Expand 3-digit shorthand (#RGB → #RRGGBB)
  const full = raw.length === 3
    ? raw.split("").map((c) => c + c).join("")
    : raw.padEnd(6, "0");
  const r = Math.min(255, Math.round(parseInt(full.slice(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(full.slice(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(full.slice(4, 6), 16) * factor));
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ─── Sizing ────────────────────────────────────────────────────────────────────

/**
 * Train rectangle dimensions at a given zoom level.
 * Base: 4 × 12 px at zoom 12. Scales ×1.45 per zoom step, capped at 22 × 60 px.
 */
export function getTrainSize(zoom: number): { w: number; h: number } {
  const scale = Math.pow(1.45, Math.max(0, zoom - 12));
  return {
    w: Math.round(Math.min(4 * scale, 22)),
    h: Math.round(Math.min(12 * scale, 60)),
  };
}

// ─── Drawing ───────────────────────────────────────────────────────────────────

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,      x + w, y + r,      r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h,  x + w - r, y + h,  r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h,      x, y + h - r,      r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y,          x + r, y,           r);
  ctx.closePath();
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function TrainLayer({ trainsRef, pathsMap }: TrainLayerProps) {
  const map = useMap();
  const pathsRef = useRef(pathsMap);
  pathsRef.current = pathsMap;

  useEffect(() => {
    // ── Canvas lives inside the overlay pane ──────────────────────────────────
    //
    // Leaflet zoom-animates by CSS-scaling the map pane (.leaflet-map-pane).
    // The overlay pane is a child of the map pane, so it inherits the same
    // CSS transform during animation.
    //
    // We opt into Leaflet's zoom-animation system by:
    //   1. Adding the 'leaflet-zoom-animated' class to our canvas so its CSS
    //      transform participates in the zoom transition.
    //   2. Listening to 'zoomanim' to apply setTransform(canvas, offset, scale)
    //      that mirrors what L.Canvas renderer does — pre-positioning the canvas
    //      at the correct location for the target zoom before the CSS animation
    //      begins, preventing the "trains fly off track" artifact.
    //   3. On 'viewreset' (animation end): resize and reposition with no scale.
    //   4. On 'move' (pan): reposition to track the moving viewport.
    //
    // Coordinates: we use latLngToLayerPoint() (pane-relative) so positions are
    // stable in the overlay pane's coordinate space during pan/zoom.
    // Create a dedicated pane above markerPane (z-index 600) so train symbols
    // are always rendered on top of station markers and track lines.
    if (!map.getPane("trainPane")) {
      const tp = map.createPane("trainPane");
      tp.style.zIndex = "650";
      tp.style.pointerEvents = "none";
    }
    const pane = map.getPane("trainPane") as HTMLElement;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;pointer-events:none;";
    canvas.classList.add("leaflet-zoom-animated");
    pane.appendChild(canvas);

    // ── Resize & reposition helpers ───────────────────────────────────────────

    function sizeCanvas() {
      const sz = map.getSize();
      canvas.width  = sz.x;
      canvas.height = sz.y;
    }

    function repositionCanvas() {
      // Shift the canvas so its (0,0) maps to the container's top-left corner
      // in the overlay pane's layer-point coordinate system.
      L.DomUtil.setPosition(
        canvas,
        map.containerPointToLayerPoint([0, 0] as L.PointExpression)
      );
    }

    sizeCanvas();
    repositionCanvas();

    // ── Draw loop ─────────────────────────────────────────────────────────────

    let rafId: number;

    function draw() {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Hide trains when zoomed too far out — symbols become meaningless noise
      const zoom = map.getZoom();
      if (zoom < MIN_TRAIN_ZOOM) return;

      // The layer-point corresponding to the canvas origin (viewport top-left)
      const origin = map.containerPointToLayerPoint([0, 0] as L.PointExpression);
      const { w, h } = getTrainSize(zoom);
      const r = Math.max(1, Math.round(w * 0.45));

      for (const train of trainsRef.current) {
        const path = pathsRef.current.get(train.routeId);
        if (!path) continue;

        const pos = getTrainLatLng(train, path);

        // Layer point — stable in the pane coordinate space
        const pt = map.latLngToLayerPoint(L.latLng(pos[0], pos[1]));

        // Canvas-local coordinates (subtract pane origin)
        const x = pt.x - origin.x;
        const y = pt.y - origin.y;

        // Stable bearing from the current waypoint segment — no pixel-projection jitter
        const angle = getTrainSegmentBearing(train, path);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        drawRoundedRect(ctx, -w / 2, -h / 2, w, h, r);
        // Use a darkened shade so trains are clearly visible against the
        // light CartoDB basemap without washing out into the line colour
        ctx.fillStyle = darkenColour(train.routeColour, 0.6);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Subtle window stripe for realism
        if (h >= 16) {
          const stripeH = Math.max(1, Math.round(h * 0.12));
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(-w / 2 + 1.5, -stripeH / 2, w - 3, stripeH);
        }

        ctx.restore();
      }
    }

    function loop() {
      draw();
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    // ── Zoom animation handling ───────────────────────────────────────────────
    //
    // During zoom animation Leaflet CSS-transforms the mapPane (translate+scale).
    // Our canvas is inside overlayPane ⊂ mapPane and inherits that transform.
    // Without intervention, our canvas's own setPosition translate would be
    // scaled by the pane's CSS scale — doubling the offset and flying off track.
    //
    // Solution: on 'zoomanim' apply setTransform(canvas, newOffset, scale) that
    // positions the canvas at the correct layer-space location for the target
    // zoom. This mirrors L.Renderer._onZoomAnimated (Leaflet source).
    //
    // Formula (mirrors Leaflet's _latLngBoundsToNewLayerBounds + _getNewPixelOrigin):
    //   newPixelOrigin = project(newCenter, newZoom) - viewSize/2 + mapPanePos
    //   newLayerPoint(topLeft) = project(topLeft, newZoom) - newPixelOrigin

    function onZoomAnim(e: L.ZoomAnimEvent) {
      const newZoom = e.zoom;
      const scale   = map.getZoomScale(newZoom, map.getZoom());

      // Current geographic position of the viewport's top-left corner
      const topLeft = map.containerPointToLatLng(
        L.point(0, 0) as L.PointExpression
      );

      // Non-animated mapPane position (what setPosition last set — NOT the CSS animation value)
      const mapPanePos = L.DomUtil.getPosition(
        map.getPanes().mapPane as HTMLElement
      );

      const viewHalf = map.getSize().divideBy(2);

      // New pixel origin at target zoom:
      //   pixelOrigin(zoom, center) = project(center, zoom) − viewSize/2 + mapPanePos
      const newPixelOrigin = map
        .project(e.center, newZoom)
        .subtract(viewHalf)
        .add(mapPanePos)
        .round();

      // New layer point for our canvas top-left at target zoom:
      //   layerPoint(p) = project(p, zoom) − pixelOrigin
      const newOffset = map.project(topLeft, newZoom).subtract(newPixelOrigin);

      L.DomUtil.setTransform(canvas as HTMLElement, newOffset as L.Point, scale);
    }

    // After zoom animation ends, the pane resets its CSS transform — resize and
    // reposition with no scale (setPosition = setTransform without scale arg).
    function onViewReset() {
      sizeCanvas();
      repositionCanvas();
    }

    map.on("zoomanim", onZoomAnim as L.LeafletEventHandlerFn);
    map.on("move", repositionCanvas);
    map.on("viewreset resize", onViewReset);

    return () => {
      cancelAnimationFrame(rafId);
      map.off("zoomanim", onZoomAnim as L.LeafletEventHandlerFn);
      map.off("move", repositionCanvas);
      map.off("viewreset resize", onViewReset);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [map, trainsRef]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
