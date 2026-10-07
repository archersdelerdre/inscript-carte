import type { CompetitionDto, GeoPosition } from '@inscript-carte/shared';
import {
  divIcon,
  type DivIcon,
  type Marker as LeafletMarker,
  type MarkerCluster,
  type MarkerClusterGroup as LeafletMarkerClusterGroup,
} from 'leaflet';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { AttributionControl, MapContainer, Marker, Popup, TileLayer, useMap, ZoomControl } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';

import { CompetitionPopupItem } from './competition-card';
import { DISCIPLINE_COLORS, MIXED_DISCIPLINES_COLOR } from './disciplines';

const FRANCE_CENTER: [number, number] = [46.6, 2.5];
const FRANCE_ZOOM = 6;

type Town = {
  key: string;
  name: string;
  /** Built once per data change: react-leaflet compares it by reference and moves the marker if it changes. */
  latLng: [number, number];
  color: string;
  competitions: CompetitionDto[];
};

export type FocusRequest = { competitionId: string; requestedAt: number };

type Props = {
  competitions: CompetitionDto[];
  /** Positions the map fits to; it re-frames only when this array changes. */
  framedPositions: GeoPosition[];
  focusRequest: FocusRequest | null;
};

export function CompetitionMap({ competitions, framedPositions, focusRequest }: Props) {
  const clusterRef = useRef<LeafletMarkerClusterGroup>(null);
  const markersRef = useRef(new Map<string, LeafletMarker>());
  const handledFocusRef = useRef<FocusRequest | null>(null);
  const registerMarker = useCallback((townKey: string, marker: LeafletMarker | null) => {
    if (marker) markersRef.current.set(townKey, marker);
    else markersRef.current.delete(townKey);
  }, []);

  const towns = useMemo(() => {
    const byTown = new Map<string, Town>();
    for (const competition of competitions) {
      if (!competition.position) continue;
      // One dot per place: the FFTA spells some towns several ways ("La Haie Fouassiere", "La Haye Fouassière").
      const key = `${competition.position.latitude},${competition.position.longitude}`;
      const town = byTown.get(key);
      if (town) town.competitions.push(competition);
      else
        byTown.set(key, {
          key,
          name: competition.town,
          latLng: [competition.position.latitude, competition.position.longitude],
          color: DISCIPLINE_COLORS[competition.discipline],
          competitions: [competition],
        });
    }
    for (const town of byTown.values()) {
      const disciplines = new Set(town.competitions.map((competition) => competition.discipline));
      if (disciplines.size > 1) town.color = MIXED_DISCIPLINES_COLOR;
    }
    return [...byTown.values()];
  }, [competitions]);

  useEffect(() => {
    if (!focusRequest || focusRequest === handledFocusRef.current) return;
    const town = townOf(towns, focusRequest.competitionId);
    const marker = town && markersRef.current.get(town.key);
    if (!marker || !clusterRef.current) return;
    handledFocusRef.current = focusRequest;
    clusterRef.current.zoomToShowLayer(marker, () => marker.openPopup());
  }, [focusRequest, towns]);

  return (
    <MapContainer
      center={FRANCE_CENTER}
      zoom={FRANCE_ZOOM}
      zoomControl={false}
      attributionControl={false}
      className='isolate size-full'
    >
      <TileLayer
        url='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        maxZoom={18}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <MarkerClusterGroup
        ref={clusterRef}
        maxClusterRadius={45}
        showCoverageOnHover={false}
        iconCreateFunction={clusterIcon}
        chunkedLoading
      >
        {towns.map((town) => (
          <TownMarker key={town.key} town={town} registerMarker={registerMarker} />
        ))}
      </MarkerClusterGroup>
      <ZoomControl position='bottomright' />
      {/* OpenStreetMap's license requires its credit; Leaflet's own "Leaflet" prefix is optional. */}
      <AttributionControl position='bottomleft' prefix={false} />
      <FitPositions positions={framedPositions} />
    </MapContainer>
  );
}

type TownMarkerProps = {
  town: Town;
  registerMarker: (townKey: string, marker: LeafletMarker | null) => void;
};

/**
 * Memoized so a re-render of the map (filters, list/map switch) leaves untouched towns alone: react-leaflet calls
 * `popup.update()` whenever a popup's children change, which makes an open popup flicker.
 */
const TownMarker = memo(function TownMarker({ town, registerMarker }: TownMarkerProps) {
  return (
    <Marker
      ref={(marker) => registerMarker(town.key, marker)}
      position={town.latLng}
      icon={townIcon(town.color)}
      title={town.name}
    >
      <Popup maxHeight={380} minWidth={300} maxWidth={340}>
        <div className='flex flex-col gap-3'>
          <p className='pr-10 text-base font-semibold'>{town.name}</p>
          {town.competitions.map((competition) => (
            <CompetitionPopupItem key={competition.id} competition={competition} />
          ))}
        </div>
      </Popup>
    </Marker>
  );
});

function townOf(towns: Town[], competitionId: string): Town | undefined {
  return towns.find((town) => town.competitions.some((competition) => competition.id === competitionId));
}

const townIcons = new Map<string, DivIcon>();

function townIcon(color: string): DivIcon {
  let icon = townIcons.get(color);
  if (!icon) {
    icon = divIcon({
      className: '',
      iconSize: [22, 22],
      // Without it the popup tip points at the dot's center and covers it.
      popupAnchor: [0, -11],
      html: `<span class="block size-full rounded-full border-2 border-white shadow-md" style="background:${color}"></span>`,
    });
    townIcons.set(color, icon);
  }
  return icon;
}

function clusterIcon(cluster: MarkerCluster): DivIcon {
  return divIcon({
    className: '',
    iconSize: [40, 40],
    html: `<span class="flex size-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md ring-4 ring-primary/25">${cluster.getChildCount()}</span>`,
  });
}

function FitPositions({ positions }: { positions: GeoPosition[] }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length === 0) map.setView(FRANCE_CENTER, FRANCE_ZOOM);
    else
      map.fitBounds(
        positions.map((position) => [position.latitude, position.longitude]),
        { padding: [40, 40], maxZoom: 11 },
      );
  }, [map, positions]);

  return null;
}
