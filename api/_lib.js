// Shared helpers for the Telegram Mini App backend (Vercel Node functions).
// Env: BOT_TOKEN, ADMIN_IDS (comma-separated Telegram user ids),
//      KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(/[\s,]+/).filter(Boolean).map(String);
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const MAX_AGE = 24 * 3600; // initData older than this is rejected

const isAdmin = id => ADMIN_IDS.includes(String(id));

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData || typeof initData !== "string") return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date") || 0) > MAX_AGE) return null;
  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

// Secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token on every webhook call.
const webhookSecret = () => crypto.createHash("sha256").update("wh:" + BOT_TOKEN).digest("hex").slice(0, 48);

// --- storage: Upstash Redis REST, in-memory fallback for local runs only ---
const mem = new Map();
async function kv(...cmd) {
  if (!KV_URL) return memCmd(cmd);
  const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
// Several commands in one round trip; returns their results in order.
async function kvPipe(cmds) {
  if (!cmds.length) return [];
  if (!KV_URL) return cmds.map(memCmd);
  const r = await fetch(KV_URL.replace(/\/$/, "") + "/pipeline", { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` }, body: JSON.stringify(cmds) });
  const j = await r.json();
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
function memCmd([op, k, ...a]) {
  switch (op) {
    case "INCRBY": { const v = Number(mem.get(k) || 0) + Number(a[0]); mem.set(k, String(v)); return v; }
    case "HSET": { const h = mem.get(k) || new Map(); for (let i = 0; i < a.length; i += 2) h.set(String(a[i]), String(a[i + 1])); mem.set(k, h); return 1; }
    case "HGET": { const h = mem.get(k); return h && h.has(String(a[0])) ? h.get(String(a[0])) : null; }
    case "HGETALL": return [...(mem.get(k) || new Map())].flat();
    case "SISMEMBER": return (mem.get(k) || new Set()).has(String(a[0])) ? 1 : 0;
    case "GET": return mem.get(k) ?? null;
    case "SET": mem.set(k, a[0]); return "OK";
    case "SADD": { const s = mem.get(k) || new Set(); a.forEach(x => s.add(String(x))); mem.set(k, s); return 1; }
    case "SREM": { const s = mem.get(k); if (s) a.forEach(x => s.delete(String(x))); return 1; }
    case "SMEMBERS": return [...(mem.get(k) || [])];
  }
  throw new Error("unsupported " + op);
}

const hash = arr => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const getUser = async id => { const v = await kv("GET", `user:${id}`); return v ? JSON.parse(v) : null; };
const saveUser = u => kv("SET", `user:${u.id}`, JSON.stringify(u));
async function listPending() {
  const ids = await kv("SMEMBERS", "pending_teachers");
  return (await Promise.all(ids.map(getUser))).filter(u => u && u.status === "pending");
}

// Approve or reject a pending teacher; notifies the teacher in Telegram.
async function decideTeacher(id, approve, adminId) {
  const u = await getUser(id);
  if (!u || u.role !== "teacher") return null;
  if (u.status !== "pending") return u;
  u.status = approve ? "active" : "rejected";
  u.decidedBy = adminId; u.decidedAt = Date.now();
  await saveUser(u);
  await kv("SREM", "pending_teachers", id);
  await tg("sendMessage", { chat_id: id, text: approve
    ? "✅ Администратор подтвердил ваш аккаунт учителя. Откройте 61 GOOD AI — панель учителя уже доступна."
    : "❌ Заявка учителя отклонена. Если это ошибка, обратитесь к администрации школы." }).catch(() => {});
  return u;
}

async function tg(method, body) {
  if (!BOT_TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

// Public view of a user record sent to the client.
const pub = u => u && ({ role: u.role, status: u.status, name: u.name, grade: u.grade, subject: u.subject, interests: u.interests || [] });

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
const send = (res, code, obj) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };

// Authenticates the request from its initData; sends 401 and returns null when invalid.
function auth(req, res) {
  const body = readBody(req);
  const user = verifyInitData(body.initData || req.headers["x-init-data"]);
  if (!user) { send(res, 401, { error: BOT_TOKEN ? "bad_init_data" : "bot_not_configured" }); return null; }
  return { user, body };
}

module.exports = { BOT_TOKEN, ADMIN_IDS, isAdmin, verifyInitData, webhookSecret, kv, kvPipe, hash, getUser, saveUser, listPending, decideTeacher, tg, pub, readBody, send, auth, storage: KV_URL ? "redis" : "memory" };
