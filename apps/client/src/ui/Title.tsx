import { audio } from "../audio/sfx";

interface Props {
  hasSave: boolean;
  onPlay(): void;
  onOnline(): void;
  onContinue(): void;
  onSettings(): void;
  onCampaign(): void;
  onDaily(): void;
  onCodex(): void;
}

/** Title screen with an animated slime backdrop (SPEC §10.1), drawn as SVG, no bitmaps. */
export function Title({
  hasSave,
  onPlay,
  onOnline,
  onContinue,
  onSettings,
  onCampaign,
  onDaily,
  onCodex,
}: Props) {
  const click = (fn: () => void) => () => {
    audio.unlock();
    audio.click();
    fn();
  };
  return (
    <main class="title-screen">
      <SlimeBackdrop />
      <div class="title-content">
        <h1 class="logo">
          Swarm
          <br />
          Bodies
        </h1>
        <p class="tagline">Grow. Starve. Swallow the rock.</p>
        <nav class="menu" aria-label="Main menu">
          {hasSave && (
            <button class="btn btn-primary" onClick={click(onContinue)}>
              Continue game
            </button>
          )}
          <button class={hasSave ? "btn" : "btn btn-primary"} onClick={click(onCampaign)}>
            Campaign
          </button>
          <button class="btn" onClick={click(onPlay)}>
            Play skirmish
          </button>
          <button class="btn" onClick={click(onOnline)}>
            Play online
          </button>
          <button class="btn" onClick={click(onDaily)}>
            Daily Seed
          </button>
          <div class="menu-row">
            <button class="btn btn-ghost" onClick={click(onCodex)}>
              Codex
            </button>
            <button class="btn btn-ghost" onClick={click(onSettings)}>
              Settings
            </button>
          </div>
        </nav>
      </div>
    </main>
  );
}

function SlimeBackdrop() {
  const blobs = [
    { cx: 22, cy: 30, r: 16, c: "var(--p0)", d: "0s" },
    { cx: 70, cy: 22, r: 12, c: "var(--p1)", d: "-3s" },
    { cx: 60, cy: 72, r: 18, c: "var(--p0)", d: "-6s" },
    { cx: 30, cy: 80, r: 10, c: "var(--p1)", d: "-9s" },
    { cx: 85, cy: 55, r: 9, c: "var(--p0)", d: "-4s" },
  ];
  return (
    <svg
      class="backdrop"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <filter id="goo">
          <feGaussianBlur stdDeviation="3" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
        </filter>
      </defs>
      <g filter="url(#goo)" opacity="0.55">
        {blobs.map((b, i) => (
          <circle
            key={i}
            class="blob"
            cx={b.cx}
            cy={b.cy}
            r={b.r}
            fill={b.c}
            style={{ animationDelay: b.d }}
          />
        ))}
      </g>
    </svg>
  );
}
