import type { GeoPosition } from '@inscript-carte/shared';

import type { PlaceAddress, PlaceLocator } from '../../application/ports/scraped-competition-store.ts';
import { geocodeCommune, geocodeTown } from './town-geocoder.ts';

/**
 * The national address service: the commune of that postal code first, else the same rules as the legacy import
 * (`known-places.ts` first, then the town in its département).
 */
export class GeoplateformePlaceLocator implements PlaceLocator {
  async locate({ postalCode, city, town }: PlaceAddress, departmentCode: string): Promise<GeoPosition | null> {
    const found =
      (postalCode && city ? await geocodeCommune(postalCode, city) : null) ??
      (await geocodeTown(city ?? town, departmentCode));
    return found && { latitude: found.latitude, longitude: found.longitude };
  }
}
