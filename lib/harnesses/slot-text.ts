/** A leading `<!-- ... -->` note for readers, dropped from a slot's text. */
export const NOTE = /^<!--[\s\S]*?-->\n/;
/** `{{> id}}` includes another slot of the same folder. */
export const INCLUDE = /\{\{> ([a-z0-9][a-z0-9/-]*)\}\}/g;

/** The slot text a file holds. Null when the file does not end with the one newline that is not part of it. */
export function slotText(raw: string): string | null {
  if (!raw.endsWith('\n')) return null;
  return raw.replace(NOTE, '').slice(0, -1);
}
