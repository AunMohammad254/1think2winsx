/**
 * What the quiz screens hold for a question the player has not answered yet. It is never sent: the
 * submit route and submit_quiz_attempt only take options 0 to 9, and one -1 used to get the whole
 * submission refused, so a player whose time ran out with a question left lost every answer.
 */
export const UNANSWERED = -1;

/** The answers worth sending: the questions the player answered. */
export function answeredOnly<T extends { selectedOption: number }>(answers: T[]): T[] {
  return answers.filter((answer) => answer.selectedOption !== UNANSWERED);
}
