import { useEffect, useState } from "preact/hooks";
import { NARRATOR, type Line, type Mood } from "@swarm/content";
import { getSettings } from "./settings";

const FUR = "#6f6a8f";
const FUR_DARK = "#4d4868";
const MUZZLE = "#c3bde0";
const INNER = "#d99ab0";
const EYE = "#f2b33e";
const INK = "#2b2740";

type Pt = [number, number];
/** Ear triangles (tip, outer base, inner base) per side, by mood: up, forward, or flattened. */
const EARS: Record<Mood, { L: Pt[]; R: Pt[] }> = {
  smug: {
    L: [
      [36, 20],
      [28, 52],
      [52, 40],
    ],
    R: [
      [86, 22],
      [92, 52],
      [68, 40],
    ],
  },
  intrigued: {
    L: [
      [40, 14],
      [30, 50],
      [54, 38],
    ],
    R: [
      [80, 14],
      [90, 50],
      [66, 38],
    ],
  },
  unimpressed: {
    L: [
      [14, 38],
      [30, 58],
      [46, 42],
    ],
    R: [
      [106, 38],
      [90, 58],
      [74, 42],
    ],
  },
};

let nextId = 0;

function tri(p: Pt[], scale: number): string {
  const cx = p.reduce((sum, [x]) => sum + x, 0) / p.length;
  const cy = p.reduce((sum, [, y]) => sum + y, 0) / p.length;
  return p.map(([x, y]) => `${cx + (x - cx) * scale},${cy + (y - cy) * scale}`).join(" ");
}

function Eye({
  x,
  y,
  side,
  mood,
  blink,
}: {
  x: number;
  y: number;
  side: -1 | 1;
  mood: Mood;
  blink: boolean;
}) {
  if (mood === "intrigued" && !blink)
    return (
      <g>
        <ellipse cx={x} cy={y} rx={8.5} ry={9.5} fill={EYE} />
        <circle cx={x} cy={y + 0.5} r={5.2} fill="#14121f" />
        <circle cx={x - 2} cy={y - 2.5} r={1.8} fill="#fff" />
      </g>
    );
  // Lids: smug covers the top half at a tilt; unimpressed (and a blink) leaves a sliver.
  const lid = blink ? 0.95 : mood === "smug" ? (side < 0 ? 0.5 : 0.42) : 0.82;
  const top = y - 8;
  const h = 16 * lid;
  const tilt = mood === "smug" && !blink ? side * 1.5 : 0;
  return (
    <g>
      <ellipse cx={x} cy={y} rx={7.5} ry={8} fill={EYE} />
      <ellipse cx={x} cy={y + 0.5} rx={2.2} ry={6.4} fill="#14121f" />
      <path
        d={`M${x - 9},${top - 2} L${x + 9},${top - 2} L${x + 9},${top + h + tilt} Q${x},${top + h + 2} ${x - 9},${top + h - tilt} Z`}
        fill={FUR}
      />
      <path
        d={`M${x - 8},${top + h - tilt} Q${x},${top + h + 2} ${x + 8},${top + h + tilt}`}
        stroke={INK}
        stroke-width={1.6}
        fill="none"
        stroke-linecap="round"
      />
    </g>
  );
}

/**
 * Dr. Ottoline Purr's portrait (docs/plans/tutorial.md): procedural SVG, three expressions. She
 * blinks now and then; a new expression pops in. With reduce motion she holds still.
 */
export function PurrPortrait({ mood, size = 64 }: { mood: Mood; size?: number }) {
  const [id] = useState(() => `purr-glass-${nextId++}`);
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (getSettings().reduceMotion) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          t = setTimeout(() => {
            setBlink(false);
            schedule();
          }, 140);
        },
        3200 + Math.random() * 3000,
      );
    };
    schedule();
    return () => clearTimeout(t);
  }, []);
  const ears = EARS[mood];
  return (
    <svg
      key={mood}
      class="purr"
      viewBox="0 0 120 124"
      width={size}
      height={(size * 124) / 120}
      role="img"
      aria-label={`${NARRATOR.fullName}, ${mood}`}
    >
      <defs>
        <radialGradient id={id} cx="38%" cy="32%" r="75%">
          <stop offset="0" stop-color="#bff3fb" stop-opacity="0.35" />
          <stop offset="0.6" stop-color="#3ed6e8" stop-opacity="0.08" />
          <stop offset="1" stop-color="#3ed6e8" stop-opacity="0.22" />
        </radialGradient>
      </defs>
      <circle cx={60} cy={58} r={54} fill="#0d1428" />
      <polygon points={tri(ears.L, 1)} fill={FUR} />
      <polygon points={tri(ears.R, 1)} fill={FUR} />
      <polygon points={tri(ears.L, 0.55)} fill={INNER} />
      <polygon points={tri(ears.R, 0.55)} fill={INNER} />
      <ellipse cx={60} cy={68} rx={36} ry={31} fill={FUR} />
      <path d="M30,60 Q60,44 90,60" stroke={FUR_DARK} stroke-width={3} fill="none" opacity={0.5} />
      <ellipse cx={60} cy={80} rx={17} ry={12} fill={MUZZLE} />
      <Eye x={46} y={64} side={-1} mood={mood} blink={blink} />
      <Eye x={74} y={64} side={1} mood={mood} blink={blink} />
      {/* The monocle. */}
      <circle cx={74} cy={64} r={10.5} fill="none" stroke="#e9c46a" stroke-width={2} />
      <path d="M84,67 Q92,82 88,98" stroke="#e9c46a" stroke-width={1} fill="none" opacity={0.8} />
      <path d="M57,74 L63,74 L60,78 Z" fill={INNER} />
      {mood === "smug" && (
        <path
          d="M53,82 Q58,85 62,82 Q67,82 70,77"
          stroke={INK}
          stroke-width={2}
          fill="none"
          stroke-linecap="round"
        />
      )}
      {mood === "intrigued" && <ellipse cx={60} cy={84} rx={3} ry={3.6} fill={INK} />}
      {mood === "unimpressed" && (
        <path d="M53,83 L67,83" stroke={INK} stroke-width={2} stroke-linecap="round" />
      )}
      {([-1, 1] as const).flatMap((s) =>
        (
          [
            [-3, 2],
            [0, 0],
            [3, -2],
          ] as const
        ).map(([dy, dt]) => (
          <path
            key={`${s}${dy}`}
            d={`M${60 + s * 14},${78 + dy} Q${60 + s * 30},${76 + dy + dt} ${60 + s * 44},${74 + dy * 2}`}
            stroke="#e8e4ff"
            stroke-opacity={0.7}
            stroke-width={1}
            fill="none"
          />
        )),
      )}
      <circle cx={60} cy={58} r={54} fill={`url(#${id})`} stroke="#9fdcef" stroke-width={3} />
      <path
        d="M24,40 A40,40 0 0 1 48,14"
        stroke="#ffffff"
        stroke-opacity={0.55}
        stroke-width={4}
        fill="none"
        stroke-linecap="round"
      />
      <rect
        x={22}
        y={104}
        width={76}
        height={16}
        rx={8}
        fill="#1a2348"
        stroke="#3ed6e8"
        stroke-width={2}
      />
      <circle cx={60} cy={112} r={3} fill="#3ed6e8" />
    </svg>
  );
}

/** One of Dr. Purr's lines, with her portrait and name. */
export function PurrSays({ line, size = 56 }: { line: Line; size?: number }) {
  return (
    <div class="purr-says">
      <PurrPortrait mood={line.mood} size={size} />
      <div>
        <p class="purr-name">{NARRATOR.name}</p>
        <p class="purr-text">{line.text}</p>
      </div>
    </div>
  );
}
