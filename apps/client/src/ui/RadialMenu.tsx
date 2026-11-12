import { forecast, getBoard, inLaunchRange, playerRules, type Hex, type Order } from "@swarm/sim";
import type { Point } from "../game/layout";
import type { MatchSession } from "../game/match-session";

interface Props {
  session: MatchSession;
  body: number;
  cell: Hex;
  at: Point;
  onAdd(o: Order): void;
  onRemove(index: number): void;
  /** Start the Launch flow from this mature fruiting body (SPEC §10.2). */
  onLaunch(cell: Hex): void;
  onClose(): void;
}

/**
 * Tap an own cell (SPEC §10.2): Reinforce, Fruit and Retract, each greyed out with the reason
 * when illegal, plus Launch on a mature fruiting body.
 */
export function RadialMenu({
  session,
  body: bodyId,
  cell,
  at,
  onAdd,
  onRemove,
  onLaunch,
  onClose,
}: Props) {
  const { planner, state, me } = session;
  const body = state.bodies[bodyId] as (typeof state.bodies)[number];
  const c = body.colony[getBoard(body.radius).indexOf(cell.q, cell.r)];
  const reinforce: Order = { type: "reinforce", body: bodyId, cell };
  const retract: Order = { type: "retract", body: bodyId, cell };
  const fruit: Order = { type: "fruit", body: bodyId, cell };
  const r1 = planner.check(reinforce);
  const r2 = planner.check(retract);
  const r3 = planner.check(fruit);
  const existing = planner.ordersAt(bodyId, cell);
  const system = state.bodies.filter((b) => b.orbit).length > 1;

  const items = [
    {
      label: "Reinforce",
      sub: r1.ok ? `${r1.cost} N · +${playerRules(state, me).reinforceAmount}` : r1.message,
      ok: r1.ok,
      act: () => onAdd(reinforce),
      icon: "+",
    },
  ];
  if (system && c?.fruiting === 0) {
    const inRange = state.bodies.filter((b) => inLaunchRange(state, body, b, state.turn, me));
    let sub: string;
    let ok = inRange.length > 0;
    if (ok) sub = `${inRange.length} bod${inRange.length === 1 ? "y" : "ies"} in range`;
    else {
      const next = forecast(state, 6, me).find((f) => f.windows.some((w) => w.from === bodyId));
      sub = next ? `Nothing in range · next window turn ${next.turn}` : "Nothing in range soon";
    }
    if (
      planner.orders.some(
        (o) =>
          o.type === "launch" && o.body === bodyId && o.cell.q === cell.q && o.cell.r === cell.r,
      )
    ) {
      ok = false;
      sub = "Already launching";
    }
    items.push({ label: "Launch", sub, ok, act: () => onLaunch(cell), icon: "⇡" });
  } else if (system) {
    items.push({
      label: "Fruit",
      sub: r3.ok
        ? `${r3.cost} N · launcher in ${state.rules.fruitMatureTurns} turns`
        : c?.fruiting !== null && c?.fruiting !== undefined
          ? `Maturing · ${c.fruiting} turn${c.fruiting === 1 ? "" : "s"} left`
          : r3.message,
      ok: r3.ok,
      act: () => onAdd(fruit),
      icon: "⚘",
    });
  }
  items.push({
    label: "Retract",
    sub: r2.ok ? `refund ${state.rules.retractRefund} N` : r2.message,
    ok: r2.ok,
    act: () => onAdd(retract),
    icon: "−",
  });

  const w = typeof window === "undefined" ? 390 : window.innerWidth;
  const left = Math.max(110, Math.min(w - 110, at.x));
  const top = Math.max(150, at.y);
  return (
    <div class="radial-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class="radial"
        style={{ left: `${left}px`, top: `${top}px` }}
        role="menu"
        aria-label="Cell actions"
      >
        <div class="radial-title">
          {c?.core
            ? "Core"
            : c?.fruiting === 0
              ? "Fruiting body (ready)"
              : c?.fruiting != null
                ? "Fruiting body"
                : "Cell"}{" "}
          · biomass {c?.biomass ?? 0}
          {c && c.owner === me && !c.connected ? " · cut off" : ""}
        </div>
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            class="radial-item"
            disabled={!it.ok}
            onClick={it.act}
          >
            <span class="radial-icon" aria-hidden="true">
              {it.icon}
            </span>
            <span class="radial-text">
              <span>{it.label}</span>
              <small>{it.sub}</small>
            </span>
          </button>
        ))}
        {existing.length > 0 && (
          <button
            role="menuitem"
            class="radial-item danger"
            onClick={() => onRemove(existing[existing.length - 1] as number)}
          >
            <span class="radial-icon" aria-hidden="true">
              ✕
            </span>
            <span class="radial-text">
              <span>Cancel order here</span>
              <small>
                {existing.length === 1 ? "1 order uses" : `${existing.length} orders use`} this cell
              </small>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
