import { hex, type Env } from "./domain";
const encoder = new TextEncoder();
export async function authorized(request: Request, token: string | undefined) {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied || supplied.length > 256) return false;
  const [a, b] = await Promise.all([supplied, `Bearer ${token}`].map(s => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  const actual = new Uint8Array(a), expected = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
async function key(env: Env) {
  if (!env.AUDIO_SIGNING_KEY || env.AUDIO_SIGNING_KEY.length < 32) throw new Error("Signing not configured");
  return crypto.subtle.importKey("raw", encoder.encode(env.AUDIO_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function audioUrl(env: Env, id: string, attempt: string) {
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.host === "configure-me.workers.dev")
    throw new Error("Configure a trusted public HTTPS origin");
  const expiry = String(Math.floor(Date.now() / 1000) + 15 * 60);
  const signature = hex(await crypto.subtle.sign("HMAC", await key(env), encoder.encode(`${id}\n${attempt}\n${expiry}`)));
  return `${origin.origin}/source/${id}?attempt=${attempt}&expires=${expiry}&signature=${signature}`;
}
export async function validAudioUrl(env: Env, url: URL, id: string) {
  const attempt = url.searchParams.get("attempt") ?? "", expiry = url.searchParams.get("expires") ?? "";
  const signature = url.searchParams.get("signature") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(attempt) || !/^\d{10}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signature) ||
      Number(expiry) < Date.now() / 1000 || Number(expiry) > Date.now() / 1000 + 901) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, s => parseInt(s, 16));
  if (!await crypto.subtle.verify("HMAC", await key(env), bytes, encoder.encode(`${id}\n${attempt}\n${expiry}`))) return false;
  const note = await env.LEDGER.getByName("personal").get(id);
  return note?.state === "running" && note.attempt_id === attempt;
}
