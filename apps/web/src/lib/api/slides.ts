import { apiError } from "@/lib/api/http";
import { loadDeck } from "@/lib/presentation-data";
import type { SlideError } from "@/lib/presentation-ops";

// A presentation's slides as the public API and MCP show them.
export async function slideList(userId: string, deckId: string) {
  const deck = await loadDeck(userId, deckId);
  return (
    deck?.slides.map((s, i) => ({
      id: s.id,
      position: i + 1,
      number: s.number,
      hidden: s.hidden,
      numberHidden: s.numberHidden,
      locked: s.locked,
      updatedAt: s.updatedAt,
    })) ?? null
  );
}

export const SLIDE_ERROR_MESSAGES: Record<SlideError, string> = {
  not_found: "The presentation or slide doesn't exist, or you can't see it.",
  forbidden: "You can't edit this presentation.",
  page_locked: "The presentation or slide is locked.",
  too_many_slides: "A presentation can have at most 200 slides.",
  conflict: "The slide can't be moved there.",
};

export function slideErrorResponse(result: { error: SlideError; message?: string }) {
  return apiError(result.error, result.message ?? SLIDE_ERROR_MESSAGES[result.error]);
}
