// Signaltöne ohne Audiodatei (Web Audio). Kursalarm und Nachrichten klingen verschieden.

type Note = [freq: number, start: number, length: number];

function play(notes: Note[], volume = 0.22) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (const [freq, start, length] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + length);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + length + 0.05);
    }
    const end = Math.max(...notes.map(([, s, l]) => s + l));
    setTimeout(() => ctx.close(), (end + 0.5) * 1000);
  } catch {
    /* ohne Ton (z. B. Browser ohne Web Audio) */
  }
}

/** Kursalarm: zwei aufsteigende Töne. */
export function alarmTone() {
  play([[880, 0, 0.25], [1175, 0.18, 0.25]], 0.25);
}

/** Wichtige Nachricht: weicher Gong; Eilmeldung: drei schnelle, höhere Töne. */
export function newsTone(urgent: boolean) {
  if (urgent) play([[1318, 0, 0.12], [1318, 0.15, 0.12], [1568, 0.3, 0.3]], 0.2);
  else play([[659, 0, 0.5], [988, 0.12, 0.6]], 0.16);
}
