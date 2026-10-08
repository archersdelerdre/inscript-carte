import type { GeoPosition } from '@inscript-carte/shared';

import type { PlaceLocator } from '../../application/ports/scraped-competition-store.ts';
import { geocodeTown } from './town-geocoder.ts';

/** The national address service, through the same rules as the legacy import (`known-places.ts` first). */
export class GeoplateformePlaceLocator implements PlaceLocator {
  async locate(place: string, departmentCode: string): Promise<GeoPosition | null> {
    const found = await geocodeTown(place, departmentCode);
    return found && { latitude: found.latitude, longitude: found.longitude };
  }
}
