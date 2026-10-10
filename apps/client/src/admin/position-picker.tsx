import type { GeoPosition } from '@inscript-carte/shared';
import { divIcon } from 'leaflet';
import { useEffect } from 'react';
import { AttributionControl, MapContainer, Marker, TileLayer, useMap, useMapEvents, ZoomControl } from 'react-leaflet';

const FRANCE_CENTER: [number, number] = [46.6, 2.5];

const dotIcon = divIcon({
  className: '',
  iconSize: [22, 22],
  html: '<span class="block size-full rounded-full border-2 border-white bg-red-600 shadow-md"></span>',
});

type Props = {
  position: GeoPosition | null;
  onChange: (position: GeoPosition) => void;
};

/** A small map: a click puts the dot there. Lazy-loaded, so Leaflet stays out of the admin chunk. */
export default function PositionPicker({ position, onChange }: Props) {
  return (
    <MapContainer
      center={position ? [position.latitude, position.longitude] : FRANCE_CENTER}
      zoom={position ? 13 : 5}
      zoomControl={false}
      attributionControl={false}
      className='isolate h-72 w-full rounded-lg border'
    >
      <TileLayer
        url='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        maxZoom={18}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {position && <Marker position={[position.latitude, position.longitude]} icon={dotIcon} />}
      <ZoomControl position='bottomright' />
      <AttributionControl position='bottomleft' prefix={false} />
      <ClickToPlace onChange={onChange} />
      <KeepSize />
    </MapContainer>
  );
}

function ClickToPlace({ onChange }: { onChange: (position: GeoPosition) => void }) {
  useMapEvents({
    click: ({ latlng }) =>
      onChange({ latitude: Math.round(latlng.lat * 1e6) / 1e6, longitude: Math.round(latlng.lng * 1e6) / 1e6 }),
  });
  return null;
}

/** The dialog animates open and the map may mount while it measures 0: measure again whenever its box changes. */
function KeepSize() {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
