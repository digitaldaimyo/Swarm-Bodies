import { useRef } from "preact/hooks";
import { newCellPositions, validateOrder, type GameState, type Hex, type Order } from "@swarm/sim";
import { mutationInfo } from "@swarm/content";
import type { MatchSession } from "../game/match-session";

interface Props {
  open: boolean;
  orders: readonly Order[];
  session: MatchSession;
  onToggle(): void;
  onFocus(h: Hex, body: number): void;
  onRemove(index: number): void;
}

function describe(state: GameState, me: number, o: Order): { title: string; cell: Hex | null } {
  if (o.type === "draft")
    return { title: `Mutation: ${mutationInfo(o.mutation).name}`, cell: null };
  const where = state.bodies.length > 1 ? ` · body ${o.body + 1}` : "";
  const d = describeOrder(state, me, o);
  return { ...d, title: d.title + where };
}

function describeOrder(
  state: GameState,
  me: number,
  o: Exclude<Order, { type: "draft" }>,
): { title: string; cell: Hex } {
  switch (o.type) {
    case "grow": {
      // Count new cells only: passing through your own cells is free and claims nothing.
      const body = state.bodies.find((b) => b.id === o.body);
      const n = body ? newCellPositions(body, me, o.path).length : o.path.length - 1;
      return {
        title: `Grow ${n} new cell${n === 1 ? "" : "s"}`,
        cell: o.path[o.path.length - 1] as Hex,
      };
    }
    case "reinforce":
      return { title: "Reinforce", cell: o.cell };
    case "retract":
      return { title: "Retract", cell: o.cell };
    case "fruit":
      return { title: "Fruit (spore launcher)", cell: o.cell };
    case "launch":
      return { title: `Launch to body ${o.targetBody + 1}`, cell: o.cell };
  }
}

/** Every queued order: tap to focus, swipe left (or press ✕) to delete (SPEC §10.2). */
export function OrderDrawer({ open, orders, session, onToggle, onFocus, onRemove }: Props) {
  const costs: number[] = [];
  orders.forEach((o, i) => {
    const r = validateOrder(session.state, session.me, o, orders.slice(0, i));
    costs.push(r.ok ? r.cost : 0);
  });
  return (
    <section class={open ? "drawer open" : "drawer"} aria-label="Order list" aria-hidden={!open}>
      <div class="drawer-head">
        <strong>Orders</strong>
        <span class="muted">
          {orders.length}/{session.state.rules.maxOrdersPerSet}
        </span>
        <button class="link" onClick={onToggle}>
          close
        </button>
      </div>
      {orders.length === 0 ? (
        <p class="muted drawer-empty">
          Drag from one of your glowing cells to grow. Tap a cell to reinforce or retract.
        </p>
      ) : (
        <ul>
          {orders.map((o, i) => (
            <SwipeRow key={`${i}:${JSON.stringify(o)}`} onDelete={() => onRemove(i)}>
              <button
                class="order-main"
                onClick={() => {
                  const cell = describe(session.state, session.me, o).cell;
                  if (cell && o.type !== "draft") onFocus(cell, o.body);
                }}
              >
                <span>{describe(session.state, session.me, o).title}</span>
                <span class="num muted">{o.type === "retract" ? "+1 N" : `${costs[i]} N`}</span>
              </button>
              <button
                class="btn btn-icon small"
                aria-label={`Delete order ${i + 1}`}
                onClick={() => onRemove(i)}
              >
                ✕
              </button>
            </SwipeRow>
          ))}
        </ul>
      )}
    </section>
  );
}

function SwipeRow({
  children,
  onDelete,
}: {
  children: preact.ComponentChildren;
  onDelete(): void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const start = useRef<{ x: number; id: number } | null>(null);
  const setX = (x: number) => {
    if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
  };
  return (
    <li
      ref={ref}
      class="order-row"
      onPointerDown={(e) => (start.current = { x: e.clientX, id: e.pointerId })}
      onPointerMove={(e) => {
        if (!start.current || start.current.id !== e.pointerId) return;
        setX(Math.min(0, e.clientX - start.current.x));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        start.current = null;
        setX(0);
        if (dx < -80) onDelete();
      }}
      onPointerCancel={() => {
        start.current = null;
        setX(0);
      }}
    >
      {children}
    </li>
  );
}
