"use client";

import React, { useEffect, useRef } from "react";
import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";

type LeafletModule = typeof import("leaflet");
type LeafletMap = import("leaflet").Map;
type LeafletMarker = import("leaflet").Marker;
type LeafletCircle = import("leaflet").Circle;

interface LocationMapPickerProps {
  latitude: string;
  longitude: string;
  radiusMeters: string;
  onChange: (latitude: string, longitude: string) => void;
}

const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753];

function parseCoordinate(value: string, fallback: number) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : fallback;
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

export function LocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onChange,
}: LocationMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const circleRef = useRef<LeafletCircle | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!containerRef.current || mapRef.current) return;

      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      leafletRef.current = L;
      const center: [number, number] = [
        parseCoordinate(latitude, DEFAULT_CENTER[0]),
        parseCoordinate(longitude, DEFAULT_CENTER[1]),
      ];

      const map = L.map(containerRef.current, {
        center,
        zoom: latitude && longitude ? 16 : 12,
        scrollWheelZoom: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const markerIcon = L.divIcon({
        className: "tatwir-location-marker",
        html: '<span></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker(center, {
        draggable: true,
        icon: markerIcon,
      }).addTo(map);

      const circle = L.circle(center, {
        radius: Math.max(10, Number(radiusMeters) || 100),
        color: "#58b046",
        fillColor: "#58b046",
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(map);

      marker.on("dragend", () => {
        const next = marker.getLatLng();
        onChange(formatCoordinate(next.lat), formatCoordinate(next.lng));
      });

      map.on("click", (event) => {
        onChange(formatCoordinate(event.latlng.lat), formatCoordinate(event.latlng.lng));
      });

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;

      setTimeout(() => map.invalidateSize(), 80);
    }

    setupMap();

    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, onChange, radiusMeters]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!L || !map || !marker || !circle) return;

    const nextLat = parseCoordinate(latitude, DEFAULT_CENTER[0]);
    const nextLng = parseCoordinate(longitude, DEFAULT_CENTER[1]);
    const nextPosition = L.latLng(nextLat, nextLng);
    const nextRadius = Math.max(10, Number(radiusMeters) || 100);

    marker.setLatLng(nextPosition);
    circle.setLatLng(nextPosition);
    circle.setRadius(nextRadius);
  }, [latitude, longitude, radiusMeters]);

  useEffect(() => {
    if (!mapRef.current) return;
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  });

  const useCurrentLocation = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition((position) => {
      const nextLatitude = formatCoordinate(position.coords.latitude);
      const nextLongitude = formatCoordinate(position.coords.longitude);
      onChange(nextLatitude, nextLongitude);
      mapRef.current?.setView([position.coords.latitude, position.coords.longitude], 17);
    });
  };

  return (
    <div className="space-y-2">
      <div className="h-[260px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={useCurrentLocation}>
          <Crosshair className="ml-2 h-4 w-4" />
          استخدم موقعي الحالي
        </Button>
      </div>
    </div>
  );
}
