import { DurableObject } from "cloudflare:workers";
import { type Env, type Note, HttpError } from "./domain";

/** One personal-account ledger serializes claims and monthly allowance reservation.
 * No external I/O occurs in transactions. Crashed inference is uncertain, not blindly rebilled.
 */
export class NotesLedger extends DurableObject<Env> {
  async commit(note: Note) {
    return this.ctx.storage.transaction(async storage => {
      const old = await storage.get<Note>(`note:${note.id}`);
      if (old) {
        if (old.sha256 !== note.sha256 || old.bytes !== note.bytes || old.filename !== note.filename ||
            old.captured_at !== note.captured_at) throw new HttpError(409, "Recording ID conflict");
        return old;
      }
      await storage.put(`note:${note.id}`, note);
      return note;
    });
  }
  async get(id: string) { return (await this.ctx.storage.get<Note>(`note:${id}`)) ?? null; }
  async list(after = "") {
    const entries = await this.ctx.storage.list<Note>({ prefix: "note:", limit: 100,
      ...(after ? { startAfter: `note:${after}` } : {}) });
    const notes = Array.from(entries.values());
    return { notes, cursor: notes.length === 100 ? notes.at(-1)!.id : null };
  }
  async claim(id: string) {
    return this.ctx.storage.transaction(async storage => {
      const note = await storage.get<Note>(`note:${id}`);
      if (!note || ["ready", "failed", "uncertain"].includes(note.state)) return null;
      if (note.state === "running") {
        if ((note.lease_until ?? 0) < Date.now()) {
          note.state = "uncertain"; note.error = "Interrupted processing; inspect before manual retry";
          await storage.put(`note:${id}`, note);
        }
        return null;
      }
      if ((note.retry_at ?? 0) > Date.now()) return null;
      const cap = Number(this.env.MONTHLY_AUDIO_SECONDS), max = Number(this.env.MAX_ATTEMPTS);
      if (!Number.isSafeInteger(cap) || cap <= 0 || !Number.isSafeInteger(max) || max <= 0 ||
          this.env.PROCESSING_ENABLED !== "true") {
        note.state = "paused"; note.error = "Processing disabled or invalid allowance";
        await storage.put(`note:${id}`, note); return null;
      }
      if (note.attempts >= max) {
        note.state = "failed"; note.error = "Retry allowance exhausted";
        await storage.put(`note:${id}`, note); return null;
      }
      const key = `usage:${new Date().toISOString().slice(0, 7)}`;
      const used = (await storage.get<number>(key)) ?? 0;
      if (used + note.duration_seconds > cap) {
        note.state = "paused"; note.error = "Monthly audio allowance exhausted";
        await storage.put(`note:${id}`, note); return null;
      }
      note.state = "running"; note.attempts++; note.attempt_id = crypto.randomUUID();
      note.lease_until = Date.now() + 20 * 60 * 1000; delete note.error;
      await storage.put({ [key]: used + note.duration_seconds, [`note:${id}`]: note });
      return note;
    });
  }
  async finish(id: string, attemptId: string, result: { outcome?: Note["outcome"]; error?: string; retryable?: boolean }) {
    return this.ctx.storage.transaction(async storage => {
      const note = await storage.get<Note>(`note:${id}`);
      if (!note || note.state !== "running" || note.attempt_id !== attemptId) return;
      if (!result.error) { note.state = "ready"; note.outcome = result.outcome; }
      else {
        note.error = result.error;
        note.state = result.retryable && note.attempts < Number(this.env.MAX_ATTEMPTS) ? "uploaded" : "failed";
        note.retry_at = Date.now() + 60000 * 2 ** (note.attempts - 1);
      }
      delete note.lease_until;
      await storage.put(`note:${id}`, note);
    });
  }
  async retry(id: string) {
    return this.ctx.storage.transaction(async storage => {
      const note = await storage.get<Note>(`note:${id}`);
      if (!note || !["failed", "paused", "uncertain"].includes(note.state)) return false;
      // Explicit manual retry grants another bounded batch; usage is never reset/refunded.
      note.state = "uploaded"; note.attempts = 0; delete note.retry_at; delete note.error;
      await storage.put(`note:${id}`, note); return true;
    });
  }
  async usage() {
    const month = new Date().toISOString().slice(0, 7);
    return { month, reserved_audio_seconds: (await this.ctx.storage.get<number>(`usage:${month}`)) ?? 0,
      monthly_audio_seconds: Number(this.env.MONTHLY_AUDIO_SECONDS), enabled: this.env.PROCESSING_ENABLED === "true" };
  }
}
