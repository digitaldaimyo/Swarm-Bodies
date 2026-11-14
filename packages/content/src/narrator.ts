/**
 * Dr. Ottoline Purr, Senior Xenobiologist aboard the survey ship *Third Nap*
 * (docs/plans/tutorial.md). A little smug, never mean; the fact comes first and is exact.
 */
export type Mood = "smug" | "intrigued" | "unimpressed";

/** One thing Dr. Purr says, and the expression she says it with. */
export interface Line {
  text: string;
  mood: Mood;
}

export const NARRATOR = { name: "Dr. Purr", fullName: "Dr. Ottoline Purr" } as const;

/** Her closing line on the results screen. */
export const RESULT_LINES: Record<"win" | "loss" | "draw", Line> = {
  win: {
    mood: "intrigued",
    text: "A thorough victory. I'll name the strain after you. Something small.",
  },
  loss: { mood: "unimpressed", text: "A setback. In the interest of science, we'll call it data." },
  draw: { mood: "smug", text: "A draw. Everyone loses equally, which is almost fair." },
};
