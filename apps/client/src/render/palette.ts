import type { BodyType, DepositKind } from "@swarm/sim";

/** SPEC §10.4: colourblind-safe player colours, each with a pattern for the pattern overlay. */
export const PLAYER_COLORS = [0x3ed6e8, 0xf25cb8, 0xf2b33e, 0x9be85a] as const;
export const PLAYER_CSS = ["#3ED6E8", "#F25CB8", "#F2B33E", "#9BE85A"] as const;
export const PLAYER_PATTERNS = ["stripes", "dots", "rings", "crosshatch"] as const;

export const SPACE = 0x070b1a;

export const BODY_TINT: Record<
  BodyType,
  { base: number; dark: number; rim: number; glow: number | null }
> = {
  carbonaceous: { base: 0x3a312b, dark: 0x231d1a, rim: 0x5a4c41, glow: null },
  icy: { base: 0x8fa6b8, dark: 0x5d7183, rim: 0xd8e8f2, glow: null },
  metallic: { base: 0x6d7178, dark: 0x45484e, rim: 0xb9bec6, glow: null },
  irradiated: { base: 0x3d4234, dark: 0x262a20, rim: 0x6f7a55, glow: 0x9be85a },
};

export const DEPOSIT_COLORS: Record<DepositKind, number> = {
  ice: 0xcdefff,
  organic: 0x3b7a3a,
  mineral: 0xc9a85c,
};

/**
 * Your cosmetics (SPEC §11.3), applied to your own seat on your own screen only: everyone else
 * still sees the standard seat colours. Null when none are active (replays, other screens).
 */
export interface LocalCosmetics {
  seat: number;
  palette: number | null;
  /** Vein thickness factor (1 is standard). */
  veinScale: number;
  trail: number | null;
}
let local: LocalCosmetics | null = null;

export function setLocalCosmetics(c: LocalCosmetics | null): void {
  local = c;
}

export function playerColor(p: number): number {
  if (local && p === local.seat && local.palette !== null) return local.palette;
  return PLAYER_COLORS[p % PLAYER_COLORS.length] as number;
}

export function playerCss(p: number): string {
  if (local && p === local.seat && local.palette !== null)
    return `#${local.palette.toString(16).padStart(6, "0")}`;
  return PLAYER_CSS[p % PLAYER_CSS.length] as string;
}

export function veinScale(p: number): number {
  return local && p === local.seat ? local.veinScale : 1;
}

/** Spore trail colour: your trail cosmetic, else the seat colour. */
export function trailColor(p: number): number {
  if (local && p === local.seat && local.trail !== null) return local.trail;
  return playerColor(p);
}

/** Mixes a colour toward grey: disconnected colonies desaturate (SPEC §10.2). */
export function desaturate(color: number, amount: number): number {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (c: number) => Math.round(c + (grey * 0.7 - c) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export function lighten(color: number, amount: number): number {
  const ch = (shift: number) => {
    const c = (color >> shift) & 255;
    return Math.round(c + (255 - c) * amount);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function darken(color: number, amount: number): number {
  const ch = (shift: number) => Math.round(((color >> shift) & 255) * (1 - amount));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Positive amounts lighten toward white, negative ones darken toward black. */
export function shade(color: number, amount: number): number {
  return amount >= 0 ? lighten(color, amount) : darken(color, -amount);
}
