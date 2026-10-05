import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import { router } from '../src/app/router';

/**
 * A missing index route is invisible until someone opens the bare domain and
 * gets React Router's developer 404. These two assertions are cheap and they
 * cover the whole class of mistake.
 */
function flatten(routes: RouteObject[]): RouteObject[] {
  return routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);
}

describe('the route table', () => {
  const routes = flatten(router.routes);

  it('answers the bare domain instead of 404ing', () => {
    expect(routes.some((r) => r.index)).toBe(true);
  });

  it('catches every unknown address', () => {
    expect(routes.some((r) => r.path === '*')).toBe(true);
  });

  it('keeps the two scan entry points public', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/e/:qrToken');
    expect(paths).toContain('/l/:labToken');
  });

  it('lets staff correct a machine after registration', () => {
    expect(routes.map((r) => r.path)).toContain('/staff/equipment/:id/edit');
  });

  it('shows our own screen when the router throws', () => {
    // The data router exposes the boundary as a flag, not as the element.
    expect(router.routes[0]?.hasErrorBoundary).toBe(true);
  });
});
