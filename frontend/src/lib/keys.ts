// Tastatur: welche Felder Tastendrücke selbst brauchen.

const TEXT_INPUTS = new Set(["text", "search", "number", "email", "url", "tel", "password"]);

type El = Pick<HTMLElement, "tagName" | "isContentEditable"> & { type?: string };

/**
 * Feld, in das man Text tippt (dort bleiben Tasten beim Feld)? Auswahlfelder, Checkboxen und
 * Knöpfe zählen nicht: Wer dort weitertippt, meint die Befehlszeile.
 */
export function isTextEntry(el: El): boolean {
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && TEXT_INPUTS.has(el.type || "text");
}
