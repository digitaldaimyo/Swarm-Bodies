import { Container, Sprite, type Texture } from "pixi.js";

/** Reusable sprites for per-cell art: redrawing a board reuses them instead of re-creating. */
export class SpritePool {
  private readonly sprites: Sprite[] = [];
  private used = 0;

  constructor(
    readonly layer: Container,
    private readonly texture: Texture,
  ) {}

  begin(): void {
    this.used = 0;
  }

  /** The next sprite, made visible, with tint and alpha set; the caller places it. */
  takeRaw(tint: number, alpha = 1): Sprite {
    let s = this.sprites[this.used];
    if (!s) {
      s = new Sprite(this.texture);
      s.anchor.set(0.5);
      this.layer.addChild(s);
      this.sprites.push(s);
    }
    this.used++;
    s.visible = true;
    s.tint = tint;
    s.alpha = alpha;
    return s;
  }

  /** A sprite centred on (x, y) with the given radius in world px. */
  take(x: number, y: number, radius: number, tint: number, alpha = 1): Sprite {
    const s = this.takeRaw(tint, alpha);
    s.rotation = 0;
    s.position.set(x, y);
    s.width = s.height = radius * 2;
    return s;
  }

  /** Hides whatever this pass did not use. */
  end(): void {
    for (let i = this.used; i < this.sprites.length; i++)
      (this.sprites[i] as Sprite).visible = false;
  }
}
