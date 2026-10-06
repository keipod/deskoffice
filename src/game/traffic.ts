import {
  ACTOR_RADIUS,
  clearMovementSegment,
  findPath,
  type NavigationPoint,
  type Walkable,
} from "./navigation";

export type TrafficPoint = NavigationPoint & { movementUncertainty?: number };
export type TrafficActor = TrafficPoint & { id: string; player?: boolean };
export const ACTOR_SEPARATION = ACTOR_RADIUS * 2;
export function segmentDistance(a: NavigationPoint, b: NavigationPoint, p: NavigationPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
/** The same swept discs are used by route planning and actual movement. */
export function clearActors(
  a: NavigationPoint,
  b: NavigationPoint,
  actors: readonly TrafficPoint[],
) {
  return actors.every((p) => {
    // Only movement needs the peer's possible next position. Stationary checks
    // are seat/goal occupancy checks and retain the actual body radius.
    const moving = a.x !== b.x || a.y !== b.y;
    const separation = ACTOR_SEPARATION + (moving ? Math.max(0, p.movementUncertainty ?? 0) : 0);
    const startDistance = Math.hypot(a.x - p.x, a.y - p.y);
    if (startDistance >= separation - 1e-7) return segmentDistance(a, b, p) >= separation - 1e-7;
    // A delayed peer snapshot can begin inside another disc. Allow recovery only
    // when distance is nondecreasing along the entire segment, never crossing it.
    const dx = b.x - a.x,
      dy = b.y - a.y;
    return (
      (a.x - p.x) * dx + (a.y - p.y) * dy >= 0 && Math.hypot(b.x - p.x, b.y - p.y) > startDistance
    );
  });
}
export function clearTraffic(
  a: NavigationPoint,
  b: NavigationPoint,
  walkable: Walkable,
  actors: readonly TrafficPoint[],
) {
  return clearMovementSegment(a, b, walkable) && clearActors(a, b, actors);
}

type Intent = {
  goal: NavigationPoint;
  ticket: number;
  retryAt: number;
  route: NavigationPoint[];
  yieldingTo?: string;
  holdUntil: number;
  blockedRetries: number;
};
const distance = (a: NavigationPoint, b: NavigationPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const toward = (a: NavigationPoint, b: NavigationPoint, amount: number) => {
  const t = Math.min(1, amount / (distance(a, b) || 1));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

/** Bounded quarter-tile search. It also handles off-center actors without rounding through walls. */
function localRoute(
  start: NavigationPoint,
  goal: NavigationPoint,
  walkable: Walkable,
  actors: readonly TrafficActor[],
  escape?: { from: NavigationPoint; to: NavigationPoint },
) {
  if (!escape && !clearActors(goal, goal, actors)) return null;
  type Node = NavigationPoint & { g: number; f: number; parent?: Node };
  const open: Node[] = [{ ...start, g: 0, f: distance(start, goal) }];
  const best = new Map<string, number>([["0,0", 0]]);
  let visited = 0;
  while (open.length && visited++ < 1200) {
    open.sort((a, b) => a.f - b.f || a.g - b.g);
    const current = open.shift()!;
    const currentKey = `${Math.round((current.x - start.x) * 4)},${Math.round((current.y - start.y) * 4)}`;
    if (current.g > (best.get(currentKey) ?? Infinity)) continue;
    const arrived = escape
      ? distance(current, start) >= 0.6 && segmentDistance(escape.from, escape.to, current) >= 0.8
      : clearTraffic(current, goal, walkable, actors);
    if (arrived) {
      const path: NavigationPoint[] = escape ? [] : [goal];
      for (let n: Node | undefined = current; n?.parent; n = n.parent)
        path.unshift({ x: n.x, y: n.y });
      return path;
    }
    // Right-hand preference is consistent for opposing headings, independent of array order.
    const angle = Math.atan2(goal.y - start.y, goal.x - start.x);
    const choices = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ];
    choices.sort(
      ([ax, ay], [bx, by]) =>
        ax * -Math.sin(angle) +
        ay * Math.cos(angle) -
        (bx * -Math.sin(angle) + by * Math.cos(angle)),
    );
    for (const [dx, dy] of choices) {
      const next = { x: current.x + dx * 0.25, y: current.y + dy * 0.25 };
      if (
        Math.abs(next.x - start.x) > 4 ||
        Math.abs(next.y - start.y) > 4 ||
        !clearTraffic(current, next, walkable, actors)
      )
        continue;
      const key = `${Math.round((next.x - start.x) * 4)},${Math.round((next.y - start.y) * 4)}`;
      const g = current.g + Math.hypot(dx, dy) * 0.25;
      if (g >= (best.get(key) ?? Infinity)) continue;
      best.set(key, g);
      open.push({ ...next, g, f: escape ? g : g + distance(next, goal), parent: current });
    }
  }
  return null;
}

/** Client-local NPC cooperation. Remote players remain obstacles, never receive movement commands. */
export class TrafficCoordinator {
  private intents = new Map<string, Intent>();
  private sequence = 0;
  searches = 0;
  private searchFrame = -1;
  private frameSearches = 0;
  private canSearch(now: number) {
    if (this.searchFrame !== now) {
      this.searchFrame = now;
      this.frameSearches = 0;
    }
    if (this.frameSearches >= 2) return false;
    this.frameSearches++;
    this.searches++;
    return true;
  }
  clear(id?: string) {
    if (id) this.intents.delete(id);
    else this.intents.clear();
  }
  step(
    id: string,
    position: NavigationPoint,
    goal: NavigationPoint,
    amount: number,
    now: number,
    walkable: Walkable,
    allActors: readonly TrafficActor[],
  ): NavigationPoint {
    const actors = allActors.filter((a) => a.id !== id);
    let state = this.intents.get(id);
    if (!state) {
      state = {
        goal,
        ticket: this.sequence++,
        retryAt: 0,
        route: [],
        holdUntil: 0,
        blockedRetries: 0,
      };
      this.intents.set(id, state);
    }
    if (distance(state.goal, goal) > 0.1) {
      state.goal = goal;
      state.route = [];
      state.yieldingTo = undefined;
    }
    if (state.yieldingTo && state.route.length === 0) {
      const other = actors.find((a) => a.id === state!.yieldingTo);
      if (other && distance(position, other) < 1.5 && now < state.holdUntil) return position;
      state.yieldingTo = undefined;
    }
    while (state.route.length && distance(position, state.route[0]) < 0.015) state.route.shift();
    const target = state.route[0] ?? goal;
    const next = toward(position, target, amount);
    const approaching = state.route.length
      ? undefined
      : actors.find((a) => {
          const intent = this.intents.get(a.id);
          if (!intent || intent.ticket >= state!.ticket || distance(position, a) > 2) return false;
          const ax = goal.x - position.x,
            ay = goal.y - position.y;
          const bx = intent.goal.x - a.x,
            by = intent.goal.y - a.y;
          return (
            ax * bx + ay * by < 0 && segmentDistance(position, toward(position, goal, 2), a) < 0.8
          );
        });
    if (!approaching && clearTraffic(position, next, walkable, actors)) return next;
    if (now < state.retryAt) return position;
    if (!this.canSearch(now)) return position;
    state.retryAt = now + 750;
    state.blockedRetries++;
    state.route = [];
    const lookAhead = toward(position, goal, 2);
    const blocker =
      approaching ??
      actors
        .filter((a) => segmentDistance(position, lookAhead, a) < ACTOR_SEPARATION + 0.1)
        .sort(
          (a, b) => distance(position, a) - distance(position, b) || a.id.localeCompare(b.id),
        )[0];
    const otherIntent = blocker && this.intents.get(blocker.id);
    const shouldYield =
      blocker &&
      (state.blockedRetries >= 4 ||
        blocker.player ||
        (otherIntent &&
          (otherIntent.ticket < state.ticket ||
            (otherIntent.ticket === state.ticket && blocker.id < id))));
    if (shouldYield) {
      const route = localRoute(position, goal, walkable, actors, {
        from: blocker,
        to: otherIntent?.goal ?? toward(blocker, position, 4),
      });
      if (route?.length) {
        state.route = route;
        state.yieldingTo = blocker.id;
        state.holdUntil = now + 4000;
        state.blockedRetries = 0;
      }
    }
    if (!state.route.length && (!shouldYield || this.canSearch(now))) {
      state.route = localRoute(position, goal, walkable, actors) ?? [];
    }
    // Both sides can be mutually blocking a space too narrow for either escape route to
    // find a detour (e.g. a one-tile corridor). Without this, they retry every 750ms forever.
    // Break the tie deterministically: the lexicographically larger id backs away from the
    // blocker to free the space, so the other side's next retry can get through.
    if (!state.route.length && blocker && state.blockedRetries > 8 && id > blocker.id) {
      const back = toward(position, blocker, -amount);
      if (clearTraffic(position, back, walkable, actors)) {
        state.blockedRetries = 0;
        return back;
      }
    }
    const detour = toward(position, state.route[0] ?? position, amount);
    return clearTraffic(position, detour, walkable, actors) ? detour : position;
  }
}

/** Prefer actor-clear coarse waypoints; temporary blocked destinations remain pending. */
export function findTrafficPath(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  walkable: Walkable,
  actors: readonly TrafficPoint[],
) {
  return (
    findPath(sx, sy, ex, ey, walkable, (a, b) => clearActors(a, b, actors)) ??
    findPath(sx, sy, ex, ey, walkable)
  );
}
