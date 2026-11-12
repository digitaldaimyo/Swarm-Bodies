import { getBoard, type Hex, type Order } from "@swarm/sim";
import type { Point } from "../game/layout";
import { HUMAN, type SkirmishSession } from "../game/session";

interface Props {
  session: SkirmishSession;
  cell: Hex;
  at: Point;
  onAdd(o: Order): void;
  onRemove(index: number): void;
  onClose(): void;
}

/**
 * Tap an own cell (SPEC §10.2): Reinforce and Retract, each greyed out with the reason when
 * illegal. Fruit and Launch join in M5 with spores.
 */
export function RadialMenu({ session, cell, at, onAdd, onRemove, onClose }: Props) {
  const { planner, state } = session;
  const reinforce: Order = { type: "reinforce", body: 0, cell };
  const retract: Order = { type: "retract", body: 0, cell };
  const r1 = planner.check(reinforce);
  const r2 = planner.check(retract);
  const existing = planner.ordersAt(0, cell);
  const body = state.bodies[0] as (typeof state.bodies)[number];
  const c = body.colony[getBoard(body.radius).indexOf(cell.q, cell.r)];
  const items = [
    {
      label: "Reinforce",
      sub: r1.ok ? `${r1.cost} N · +${state.rules.reinforceAmount}` : r1.message,
      ok: r1.ok,
      act: () => onAdd(reinforce),
      icon: "+",
    },
    {
      label: "Retract",
      sub: r2.ok ? `refund ${state.rules.retractRefund} N` : r2.message,
      ok: r2.ok,
      act: () => onAdd(retract),
      icon: "−",
    },
  ];
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
          {c?.core ? "Core" : "Cell"} · biomass {c?.biomass ?? 0}
          {c && c.owner === HUMAN && !c.connected ? " · cut off" : ""}
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
