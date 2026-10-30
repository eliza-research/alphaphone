import { MapsController as SharedMapsController } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
import type { MapsProvider, ProviderConfig } from './contracts';
import { NativeMapsLocation } from './native-location';
import { SavedPlaces } from './saved-places';
import type {MapsLocation} from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/location.ts';
export type { MapsState } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/state.ts';
/** Compose the shared controller with this installation's storage and device bridge. */
export class MapsController extends SharedMapsController {
 constructor(config: ProviderConfig = { status: 'unconfigured' }, provider?: MapsProvider, savedPlaces = new SavedPlaces(), location:MapsLocation = new NativeMapsLocation()) {
  super(config, provider, savedPlaces, location);
 }
}
