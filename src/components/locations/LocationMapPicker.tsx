"use client";

import React, { useEffect, useRef, useState } from "react";
import { Crosshair, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

interface PlaceSearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

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

  const selectPlace = (place: PlaceSearchResult) => {
    const nextLatitude = formatCoordinate(Number(place.lat));
    const nextLongitude = formatCoordinate(Number(place.lon));

    onChange(nextLatitude, nextLongitude);
    mapRef.current?.setView([Number(place.lat), Number(place.lon)], 17);
    setResults([]);
    setQuery(place.display_name);
  };

  const searchPlaces = async () => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
      setSearchError("اكتب 3 أحرف على الأقل للبحث.");
      return;
    }

    setSearching(true);
    setSearchError("");

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=ar,en&q=${encodeURIComponent(trimmedQuery)}`,
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const payload = await response.json();
      const nextResults = Array.isArray(payload) ? payload as PlaceSearchResult[] : [];
      setResults(nextResults);
      if (nextResults.length === 0) {
        setSearchError("لم يتم العثور على نتائج.");
      }
    } catch {
      setResults([]);
      setSearchError("تعذر البحث الآن. جرّب مرة أخرى.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                searchPlaces();
              }
            }}
            placeholder="ابحث عن مدينة، فرع، شارع أو مكان..."
          />
          <Button type="button" variant="outline" onClick={searchPlaces} disabled={searching}>
            <Search className="ml-2 h-4 w-4" />
            {searching ? "بحث..." : "بحث"}
          </Button>
        </div>

        {(results.length > 0 || searchError) && (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            {results.map((place) => (
              <button
                key={place.place_id}
                type="button"
                className="block w-full border-b border-slate-100 px-3 py-2 text-right text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
                onClick={() => selectPlace(place)}
              >
                <span className="line-clamp-2">{place.display_name}</span>
              </button>
            ))}
            {searchError && results.length === 0 && (
              <p className="px-3 py-2 text-sm text-red-600">{searchError}</p>
            )}
          </div>
        )}
      </div>

      <div className="h-[210px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 sm:h-[260px]">
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
