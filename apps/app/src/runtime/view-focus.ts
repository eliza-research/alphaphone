/**
 * Focus follows the screen (PRD AP-15: TalkBack, keyboard and repeated HOME).
 *
 * Opening an app from Home, going Home (Android's HOME key, Back, "Back to apps"), moving to
 * another app or opening All apps retires the layer that held focus: it becomes inert or is
 * removed, and the browser drops focus to the page body. Inside Android WebView TalkBack follows
 * input focus, so with focus on the body a screen reader user heard nothing after HOME or after
 * opening an app and had to explore the screen to learn where they were; a keyboard user's next
 * Tab started from a control that was no longer on screen.
 *
 * When focus has been dropped (it is on the body, on a detached element, or inside content that
 * is now inert or hidden) after the active view changes, HOME is pressed, a modal surface opens or
 * the window is rotated, focus moves to what is now in front:
 *
 * - an open inline modal surface (`role="dialog"` with `aria-modal="true"` that is not a native
 *   `<dialog>`, such as the All apps drawer), named by its own label;
 * - otherwise the screen's own name: the visible title of the app in front
 *   (`[data-alpha-app-title]`; the app's labelled region where it has no title row), or the Home
 *   region when Home is in front.
 *
 * The target is made programmatically focusable (tabindex="-1", so it never becomes a tab stop)
 * and focused without scrolling, which TalkBack announces and from which Tab continues into that
 * screen. A focusable region or dialog named by an attribute keeps its children on Android
 * (Chromium never collapses it into one node), so TalkBack still reaches every control inside it.
 *
 * Focus that is somewhere real is never moved: the composer, a field or control a view focused
 * itself (subview-accessibility.ts, inline-modal.ts, the Notes surfaces), a native `<dialog>`
 * (the browser focuses it), the conversation or the voice panel. The first view of a page load is
 * left alone (startup dialogs own focus), and a resize never gives focus to a page that had none.
 */
export const VIEW_FOCUS_ATTRIBUTE = 'data-alpha-view-focus';
const TITLE = '[data-alpha-app-title]';
const HOME = '[data-alpha-layer="home"]';
const APP = '[data-alpha-layer="app"][role="region"]';
/** Surfaces that manage their own focus: a screen change behind them does not take it. */
const SELF_FOCUSED = 'dialog[open],[aria-label="Voice conversation"],[data-alpha-layer="conversation"][aria-hidden="false"],[data-alpha-voice-panel]';
/** Inline modal surfaces drawn in the page: they get focus when they open over dropped focus. */
const INLINE_MODAL = '[role="dialog"][aria-modal="true"]:not(dialog),[role="alertdialog"]:not(dialog)';
/** Frames to wait for the new screen to render its title before giving up. */
const FRAMES = 12;

function exposed(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.closest('[inert],[aria-hidden="true"],[hidden]')) return false;
  if (!element.getClientRects().length) return false;
  // Chromium keeps geometry inside a closed <details>; checkVisibility knows it is not painted.
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) return false;
  return getComputedStyle(element).visibility === 'visible';
}

/** True when focus is nowhere a person could be: the body, a detached element, or retired content. */
export function focusDropped(doc: Document = document): boolean {
  const active = doc.activeElement;
  if (!active || active === doc.body || active === doc.documentElement) return true;
  if (!active.isConnected) return true;
  if (active.closest('[inert],[aria-hidden="true"],[hidden]')) return true;
  return !active.getClientRects().length;
}

/**
 * The element that names the screen in front: the app's visible title, else the app's own labelled
 * region (Maps and the browser page have no title row), or the Home region when Home is in front.
 */
export function screenFocusTarget(doc: Document = document): HTMLElement | null {
  const view = doc.documentElement.dataset.activeView || 'home';
  if (view === 'home') {
    const home = doc.querySelector(HOME);
    return exposed(home) ? home : null;
  }
  for (const title of doc.querySelectorAll(TITLE)) if (exposed(title) && (title.textContent || '').trim()) return title as HTMLElement;
  const region = doc.querySelector(APP);
  return exposed(region) && region.getAttribute('aria-label') ? region : null;
}

/** The topmost open inline modal surface that has a name, or null. */
function inlineModal(doc: Document): HTMLElement | null {
  const open = Array.from(doc.querySelectorAll(INLINE_MODAL)).filter(exposed).filter(element => element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'));
  return (open.at(-1) as HTMLElement | undefined) ?? null;
}

/** Where dropped focus belongs now, or null when a surface that manages its own focus is open. */
export function focusTarget(doc: Document = document): HTMLElement | null {
  if (Array.from(doc.querySelectorAll(SELF_FOCUSED)).some(exposed)) return null;
  return inlineModal(doc) ?? screenFocusTarget(doc);
}

/** Moves dropped focus to what is in front. Returns whether focus was moved. */
export function focusScreen(doc: Document = document): boolean {
  if (!focusDropped(doc)) return false;
  const target = focusTarget(doc);
  if (!target) return false;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.setAttribute(VIEW_FOCUS_ATTRIBUTE, '');
  target.focus({ preventScroll: true });
  return doc.activeElement === target;
}

let installed: (() => void) | null = null;
/** Installed once per document; a second call returns the same uninstaller. */
export function installViewFocus(doc: Document = document): () => void {
  if (installed) return installed;
  const view = doc.defaultView!;
  let frame = 0, remaining = 0;
  const step = () => {
    frame = 0;
    // A view may render its title a frame or two after the switch; Home is there at once.
    if (focusScreen(doc) || !focusDropped(doc) || --remaining <= 0) return;
    frame = view.requestAnimationFrame(step);
  };
  const schedule = () => {
    remaining = FRAMES;
    if (frame) view.cancelAnimationFrame(frame);
    // Two frames: the retired layer is inert and the new one painted before focus is judged.
    frame = view.requestAnimationFrame(() => { frame = view.requestAnimationFrame(step); });
  };
  let current = doc.documentElement.dataset.activeView;
  const changes = new MutationObserver(() => {
    const next = doc.documentElement.dataset.activeView;
    // The first view of a load is not a screen change: startup surfaces own focus then.
    if (next === current) return;
    const previous = current; current = next;
    if (previous !== undefined && next !== undefined) schedule();
  });
  changes.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-active-view'] });
  // An inline modal surface opening (All apps) changes no view. Only a newly seen one is judged,
  // and only after the cheap selector finds one, so ordinary renders cost no layout.
  const seenModals = new WeakSet<Element>();
  const surfaces = new MutationObserver(() => {
    if (!doc.querySelector(INLINE_MODAL)) return;
    let fresh = false;
    for (const element of doc.querySelectorAll(INLINE_MODAL)) if (!seenModals.has(element)) { seenModals.add(element); fresh = true; }
    if (fresh && current !== undefined) schedule();
  });
  surfaces.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role'] });
  // HOME on Home (an open All apps drawer, a closed menu) changes no view but can still drop focus.
  view.addEventListener('launcher-home', schedule);
  // Rotation and window resizing can rebuild the layer that held focus. Only focus a person had and
  // lost counts: a page that never had focus (a fresh load) is not given any by a resize.
  let held: Element | null = null;
  const seen = (event: FocusEvent) => { held = event.target instanceof Element ? event.target : null; };
  const resized = () => { if (held && held !== doc.activeElement) schedule(); };
  doc.addEventListener('focusin', seen, true);
  view.addEventListener('resize', resized);
  const style = doc.createElement('style');
  style.dataset.alphaViewFocus = '';
  // Programmatic focus on a title, region or surface shows a ring only for keyboard users (:focus-visible).
  style.textContent = `[${VIEW_FOCUS_ATTRIBUTE}]:focus{outline:none}[${VIEW_FOCUS_ATTRIBUTE}]:focus-visible{outline:2px solid var(--acc,#0000ff);outline-offset:-2px;border-radius:6px}`;
  doc.head.append(style);
  installed = () => {
    installed = null;
    changes.disconnect();
    surfaces.disconnect();
    view.removeEventListener('launcher-home', schedule);
    doc.removeEventListener('focusin', seen, true);
    view.removeEventListener('resize', resized);
    if (frame) view.cancelAnimationFrame(frame);
    style.remove();
  };
  return installed;
}
