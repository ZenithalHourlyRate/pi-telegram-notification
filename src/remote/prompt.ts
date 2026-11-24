/** How much of the first prompt /ls shows. */
export const FIRST_PROMPT_CHARS = 120;

/** A prompt on one line and shortened, or undefined when it has no text. */
export function promptLine(content: string | Array<{ type: string; text?: string }>): string | undefined {
  const text = typeof content === "string"
    ? content
    : content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join(" ");
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > FIRST_PROMPT_CHARS ? `${line.slice(0, FIRST_PROMPT_CHARS - 1)}…` : line;
}
