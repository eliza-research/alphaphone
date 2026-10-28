import { installDockClearance as installSharedDockClearance, visibleDocks as sharedVisibleDocks } from '../../../../.eliza/client-features/packages/ui/src/components/shell/dock-clearance.ts';
/**
 * How much of the bottom of the phone the floating dock takes (the composer bar with whatever is
 * stacked on it, or the pill), measured, in the phone canvas's own pixels.
 *
 * The dock floats over the page. Home used to scroll underneath it with a fixed 108px of padding,
 * which stopped being enough as soon as Home needed to scroll: at 200% text the last row of apps
 * was drawn under the composer, and TalkBack read the composer after controls that sat lower on
 * the screen (round 8 emulator run). A fixed number cannot be right either way: Android moves the
 * dock up by the navigation bar inset, and the composer grows with a longer draft or a status
 * line. So the footprint is measured and published as `--alpha-dock-clearance` on the root
 * element; phone.css gives Home, the app library and every app scroller that
 * much scroll padding so a focused control is brought wholly above the dock.
 * Home and the app library fill the phone behind the floating dock; clearance
 * belongs inside their scroll content rather than clipping the outer viewport.
 *
 * Two lengths are published. `--alpha-dock-clearance` is everything the dock
 * covers now. `--alpha-dock-rest` is the bar alone. Measurements use layout
 * coordinates: entrance animations and chat dragging must not resize Home.
 *
 * While no dock is on screen (the shade, a voice session, the lock screen) the last footprint is
 * kept, so Home does not jump when the dock returns.
 */
export const DOCK_CLEARANCE_PROPERTY = '--alpha-dock-clearance';
export const DOCK_REST_PROPERTY = '--alpha-dock-rest';
const DOCK = '[data-alpha-layer="composer"],[data-alpha-layer="pill"] > *';

/** The dock elements on screen now: rendered, and not retired behind the shade or a voice session. */
export function visibleDocks(root: ParentNode = document): HTMLElement[] {
  return sharedVisibleDocks(root, DOCK);
}

let installed: (() => void) | null = null;
/**
 * Installed once per document; a second call returns the same uninstaller. The measuring and
 * publishing are shared with Eliza (packages/ui/src/components/shell/dock-clearance.ts); Alpha
 * supplies its screen, dock and bar selectors and its installed property names.
 */
export function installDockClearance(): () => void {
  if (installed) return installed;
  const uninstall = installSharedDockClearance({ screen: '[data-screen]', docks: DOCK, bar: '[data-alpha-input-bar]', clearanceProperty: DOCK_CLEARANCE_PROPERTY, restProperty: DOCK_REST_PROPERTY });
  installed = () => { installed = null; uninstall(); };
  return installed;
}
