// The resident side of committed manual-view history, for the in-page native fixtures of the
// *.production.spec.ts files.
//
// view-navigation.ts (observeCommittedView) records each manual screen the renderer commits through
// the resident's own owner-bound routes: a prepare-only POST /api/views/<id>/navigate, then
// /api/views/interact-claim and /api/views/interact-result. The shapes follow the pinned
// vendor/eliza packages/agent/src/api/views-routes.ts. The fixture keeps only bindings it issued, so
// a claim or result for anything else still falls through to the spec's unexpected-route list.
//
// Evidence boundary: a synthetic resident in the page. It is not the resident runtime.
import type { Page } from '@playwright/test';

export async function committedViewResident(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    const bindings = new Map<string, { requestId: string; clientId: string; viewId: string; viewType: string; installationId: string }>();
    const ok = (value: unknown) => ({ status: 200, data: value });
    w.committedViewResident = {
      /** Views whose observation the resident accepted, in order. */
      views: [] as string[],
      /** The response for one of the three committed-view routes, or null for any other request. */
      handle(method: string, path: string, body: any, installationId: string): { status: number; data: unknown } | null {
        if (method !== 'POST' || !body || typeof body !== 'object') return null;
        const navigate = /^\/api\/views\/([A-Za-z0-9_-]+)\/navigate$/.exec(path);
        if (navigate && body.delivery === 'completed-action' && body.prepareOnly === true && typeof body.completedActionHandoffId === 'string') {
          const binding = { requestId: body.completedActionHandoffId, clientId: String(body.clientId), viewId: navigate[1], viewType: 'gui', installationId: installationId || 'fixture-installation' };
          bindings.set(binding.requestId, binding);
          return ok({ ok: true, status: 'prepared', viewId: binding.viewId, completedActionHandoffId: binding.requestId, navigationBinding: binding });
        }
        const binding = bindings.get(body.requestId);
        if (!binding || body.clientId !== binding.clientId) return null;
        if (path === '/api/views/interact-claim') return ok({ claimId: 'committed-claim-' + binding.requestId });
        if (path === '/api/views/interact-result' && body.claimId === 'committed-claim-' + binding.requestId) {
          bindings.delete(binding.requestId);
          if (body.success === true) w.committedViewResident.views.push(binding.viewId);
          return ok({ ok: true, accepted: body.success === true });
        }
        return null;
      },
    };
  });
}

/** Views the synthetic resident recorded as committed manual screens. */
export const committedViews = (page: Page) => page.evaluate(() => [...((window as any).committedViewResident?.views ?? [])]) as Promise<string[]>;
