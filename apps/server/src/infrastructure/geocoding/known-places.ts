import type { GeoPosition } from '@inscript-carte/shared';

/**
 * FFTA "town" texts the address service cannot resolve, keyed by `département|text` exactly as the FFTA writes them.
 * Looked up by hand on Google Maps on 2026-10-06. Placeholders ("A Définir", "Inconnu", "Occitanie") are left out
 * on purpose: they name no place.
 */
export const KNOWN_PLACES: Record<string, GeoPosition & { place: string }> = {
  '02|Perles les Srptvallons': { latitude: 49.326656, longitude: 3.655378, place: 'Perles, Les Septvallons' },
  '06|Principaute de Monaco': { latitude: 43.7384176, longitude: 7.4246158, place: 'Monaco' },
  '18|Gymnase Jacques Prevert': {
    latitude: 47.1033346,
    longitude: 2.4816312,
    place: 'Gymnase Jacques Prévert, Saint-Germain-du-Puy',
  },
  '24|Gymnase Jean Zay la Roche-Chalais': {
    latitude: 45.1498287,
    longitude: 0.012442,
    place: 'Gymnase Jean Zay, La Roche-Chalais',
  },
  '27|Le Bois du Pre Bourbeux Louversey': { latitude: 48.990535, longitude: 0.920571, place: 'Louversey' },
  '28|Salle de la Madeleine Chartres6': {
    latitude: 48.4468102,
    longitude: 1.5234379,
    place: 'Complexe sportif de la Madeleine, Chartres',
  },
  '28|Salle des Sports': {
    latitude: 48.0999534,
    longitude: 1.1267688,
    place: "Salle des sports d'Arrou (organizer: Les Archers d'Arrou), Vald'Yerre",
  },
  '38|Eybens Terrain Exterieur': { latitude: 45.1487514, longitude: 5.7531397, place: "Archers du Château d'Eybens" },
  '39|Damparis (bois des Bruleux)': { latitude: 47.068033, longitude: 5.414267, place: 'Damparis' },
  '45|Montberneaume': { latitude: 48.130977, longitude: 2.316086, place: 'Montberneaume, Yèvre-la-Ville' },
  '47|Lac de Macachaud': { latitude: 44.5410709, longitude: 0.1270656, place: 'Lac de Marcachaud, Sainte-Bazeille' },
  '51|Ay': { latitude: 49.0466785, longitude: 4.0358358, place: 'Aÿ-Champagne' },
  '60|Centre de Vacances du Blanc Mesnil le Plémont': {
    latitude: 49.1467076,
    longitude: 2.8070447,
    place: 'Centre de vacances Le Plémont, Brégy',
  },
  '60|Clairoix Salle des Sports': { latitude: 49.4420891, longitude: 2.8443429, place: 'Place des Fêtes, Clairoix' },
  '61|Salle Polyvalente de Banvou': { latitude: 48.664262, longitude: -0.553412, place: 'Salle polyvalente, Banvou' },
  '66|Saint Cy¨rien': { latitude: 42.61783, longitude: 3.004182, place: 'Saint-Cyprien' },
  "68|Centre Sportif Régional d'Alsace - Mulhouse": {
    latitude: 47.7314416,
    longitude: 7.3157484,
    place: "Centre Sportif Régional d'Alsace, Mulhouse",
  },
  '75|Cnsd Fontainebleau': {
    latitude: 48.3979644,
    longitude: 2.7325034,
    place: 'Académie militaire des sports de la Défense (ex-CNSD), Fontainebleau',
  },
  '81|Boulodrome Jean Imbert - Albi': { latitude: 43.930374, longitude: 2.136314, place: 'Albi' },
  '89|Club Vert Auxerre': { latitude: 47.7791509, longitude: 3.6032893, place: 'Le Club Vert, Auxerre' },
  '93|Chennevières': {
    latitude: 48.797597,
    longitude: 2.55921,
    place: 'CTS Arc Chennevières (Île-de-France archery committee), Chennevières-sur-Marne',
  },
};
