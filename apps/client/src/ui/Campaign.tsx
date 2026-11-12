import { useState } from "preact/hooks";
import {
  CAMPAIGN,
  MODIFIERS,
  TWISTS,
  mutationInfo,
  nodeOpen,
  strainInfo,
  unlockedStrains,
  type CampaignNode,
} from "@swarm/content";
import type { StrainId } from "@swarm/sim";
import { audio } from "../audio/sfx";
import { useProgress } from "./progress";

interface Props {
  onBack(): void;
  onPlay(node: CampaignNode, strain: Exclude<StrainId, "base">): void;
}

type NodeStatus = "done" | "open" | "locked";

/**
 * Campaign map (SPEC §11.1, screen 7): a galaxy of 12 systems as a node graph with branches.
 * Tap a node for its briefing; open nodes can be played, finished ones replayed.
 */
export default function Campaign({ onBack, onPlay }: Props) {
  const progress = useProgress();
  const done = new Set(progress.completedNodes);
  const status = (n: CampaignNode): NodeStatus =>
    done.has(n.id) ? "done" : nodeOpen(n, done) ? "open" : "locked";
  const firstOpen = CAMPAIGN.find((n) => status(n) === "open") ?? CAMPAIGN[0];
  const [picked, setPicked] = useState<CampaignNode | null>(null);
  const strains = unlockedStrains(progress).filter(
    (s): s is Exclude<StrainId, "base"> => s !== "base",
  );
  return (
    <main class="panel-screen campaign">
      <header class="screen-header">
        <button class="btn btn-icon" onClick={onBack} aria-label="Back" title="Back">
          ←
        </button>
        <h2>Campaign</h2>
        <span class="muted header-note">
          {done.size}/{CAMPAIGN.length}
        </span>
      </header>
      <div class="galaxy" role="list" aria-label="Campaign systems">
        <svg class="galaxy-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {CAMPAIGN.flatMap((n) =>
            n.after.map((a) => {
              const from = CAMPAIGN.find((m) => m.id === a);
              if (!from) return null;
              return (
                <line
                  key={`${a}-${n.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={n.x}
                  y2={n.y}
                  class={done.has(a) ? "link lit" : "link"}
                  vector-effect="non-scaling-stroke"
                />
              );
            }),
          )}
        </svg>
        {CAMPAIGN.map((n) => {
          const st = status(n);
          return (
            <button
              key={n.id}
              role="listitem"
              class={`galaxy-node ${st}${n === firstOpen ? " next" : ""}`}
              style={{ left: `${6 + n.x * 0.88}%`, top: `${6 + n.y * 0.88}%` }}
              aria-label={`${n.index}. ${n.name}, ${st === "done" ? "complete" : st === "open" ? "open" : "locked"}`}
              data-node={n.id}
              onClick={() => {
                audio.click();
                setPicked(n);
              }}
            >
              {st === "done" ? "✓" : st === "locked" ? "·" : n.index}
            </button>
          );
        })}
      </div>
      {picked ? (
        <Briefing
          node={picked}
          status={status(picked)}
          strains={strains}
          onClose={() => setPicked(null)}
          onPlay={(s) => onPlay(picked, s)}
        />
      ) : (
        <p class="hint center">Tap a system for its briefing.</p>
      )}
    </main>
  );
}

function Briefing({
  node,
  status,
  strains,
  onClose,
  onPlay,
}: {
  node: CampaignNode;
  status: NodeStatus;
  strains: Exclude<StrainId, "base">[];
  onClose(): void;
  onPlay(strain: Exclude<StrainId, "base">): void;
}) {
  const [strain, setStrain] = useState<Exclude<StrainId, "base">>(
    (node.you as Exclude<StrainId, "base"> | null) ?? strains[0] ?? "swarmer",
  );
  const rivals = node.map.players - 1;
  const mod = node.modifier ? MODIFIERS[node.modifier] : null;
  const twist = node.twist ? TWISTS[node.twist] : null;
  const unlocks = [
    ...(node.unlocks.strains ?? []).map((s) => `${strainInfo(s).name} strain`),
    ...(node.unlocks.mutations ?? []).map((m) => `${mutationInfo(m).name} mutation`),
  ];
  return (
    <section class="card briefing" aria-label={`Briefing: ${node.name}`}>
      <header class="briefing-head">
        <h3>
          {node.index}. {node.name}
        </h3>
        <button
          class="btn btn-icon small-btn"
          onClick={onClose}
          aria-label="Close briefing"
          title="Close briefing"
        >
          ×
        </button>
      </header>
      <p>{node.blurb}</p>
      <ul class="facts">
        <li>
          {node.map.mode === "singleRock"
            ? "Single Rock"
            : node.map.rules?.systemMinNeutrals === 0
              ? "Two-body system"
              : "Asteroid system"}{" "}
          · {rivals} {node.opponent.difficulty} {strainInfo(node.opponent.strain).name} bot
          {rivals > 1 ? "s" : ""}
        </li>
        {mod && (
          <li>
            <strong>{mod.name}:</strong> {mod.description}
          </li>
        )}
        {twist && (
          <li>
            <strong>Objective:</strong> {twist.text}
          </li>
        )}
        {node.tutorial.length > 0 && <li>Tutorial: guided steps on this map.</li>}
        {unlocks.length > 0 && (
          <li>
            <strong>Unlocks:</strong> {unlocks.join(", ")}
          </li>
        )}
      </ul>
      {status === "locked" ? (
        <p class="hint">Complete an earlier system on the path to open this one.</p>
      ) : (
        <>
          {node.you ? (
            <p class="hint">You play {strainInfo(node.you).name} here.</p>
          ) : (
            <div class="segmented wrap" role="radiogroup" aria-label="Your strain">
              {strains.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={strain === s}
                  class={strain === s ? "seg active" : "seg"}
                  onClick={() => setStrain(s)}
                >
                  {strainInfo(s).name}
                </button>
              ))}
            </div>
          )}
          <button
            class="btn btn-primary btn-wide"
            onClick={() => {
              audio.click();
              onPlay(strain);
            }}
          >
            {status === "done" ? "Replay" : "Play"}
          </button>
        </>
      )}
    </section>
  );
}
