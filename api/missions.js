// POST {initData, action, ...}: missions, sign-ups and GOOD points.
//   list                      -> feed for students, own missions with participants for teachers
//   get     {id}              -> one mission (opened from an invite link)
//   create  {mission}         -> active teacher publishes a mission or club
//   edit    {id, mission}     -> author changes it; signed-up students get notified of date/place changes
//   delete  {id}              -> author removes it
//   join    {id}              -> active student signs up
//   confirm {id, student}     -> mission author confirms; points go to the student
//   close   {id}              -> mission author stops sign-ups
// Keys: mission:{id} JSON, missions (set), joins:{id} hash student -> joined|done,
//       uj:{student} set of mission ids, pts:{student}, cls:{grade} class total.
const crypto = require("crypto");
const { auth, getUser, kv, kvPipe, hash, tg, send } = require("./_lib");

const AGES = ["7+", "10+", "11+", "12+", "14+"];
const GPS = [10, 20, 30, 40, 50];
const EMOJI = ["⚽", "💻", "🎨", "📚", "📸", "🌱", "🎧", "🔬"];
const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const BOT_LINK = id => `https://t.me/goodaiuz_bot?start=m_${id}`;

async function loadAll(ids) {
  const res = await kvPipe(ids.flatMap(id => [["GET", `mission:${id}`], ["HGETALL", `joins:${id}`]]));
  return ids.map((id, i) => {
    const m = res[2 * i] ? JSON.parse(res[2 * i]) : null;
    if (m) m.joins = hash(res[2 * i + 1]);
    return m;
  }).filter(Boolean).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.time || "").localeCompare(b.time || "") || b.createdAt - a.createdAt);
}

const view = (m, uid) => {
  const states = Object.values(m.joins);
  return { id: m.id, type: m.type, title: m.title, desc: m.desc, cat: m.cat, emoji: EMOJI[m.cat], gp: m.gp, spots: m.spots, age: m.age,
    date: m.date || "", time: m.time || "", when: m.when || "", where: m.where, author: m.authorName, mine: String(m.authorId) === uid,
    status: m.status, count: states.length, done: states.filter(s => s === "done").length, my: m.joins[uid] || null, link: BOT_LINK(m.id) };
};

// Validated mission fields from the client; returns null when required ones are missing.
function fields(x) {
  const type = x.type === "c" ? "c" : "m";
  const f = { type, title: clean(x.title, 80), desc: clean(x.desc, 400), cat: Math.max(0, Math.min(7, parseInt(x.cat, 10) || 0)),
    gp: type === "m" && GPS.includes(+x.gp) ? +x.gp : 0, spots: Math.max(1, Math.min(40, parseInt(x.spots, 10) || 5)),
    age: AGES.includes(x.age) ? x.age : "10+", date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : "",
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) ? x.time : "", where: clean(x.where, 40) };
  if (f.title.length < 3 || !f.date || !f.where || (type === "m" && !f.gp)) return null;
  return f;
}

async function points(u) {
  const [p, c] = await kvPipe([["GET", `pts:${u.id}`], ["GET", `cls:${u.grade}`]]);
  return { points: Number(p || 0), classPoints: Number(c || 0) };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const a = auth(req, res); if (!a) return;
  const me = await getUser(a.user.id);
  if (!me || me.status !== "active") return send(res, 403, { error: "not_active" });
  const b = a.body, uid = String(me.id);
  const teacher = me.role === "teacher", student = me.role === "student";

  const own = async id => {
    const m = (await loadAll([String(id)]))[0];
    if (!m) { send(res, 404, { error: "not_found" }); return null; }
    if (String(m.authorId) !== uid) { send(res, 403, { error: "not_author" }); return null; }
    return m;
  };
  const save = m => { const { joins, ...rest } = m; return kv("SET", `mission:${m.id}`, JSON.stringify(rest)); };

  switch (b.action) {
    case "get": {
      const m = (await loadAll([String(b.id)]))[0];
      if (!m) return send(res, 404, { error: "not_found" });
      return send(res, 200, { item: view(m, uid) });
    }
    case "create": {
      if (!teacher) return send(res, 403, { error: "teachers_only" });
      const f = fields(b.mission || {});
      if (!f) return send(res, 400, { error: "bad_input" });
      const m = { id: crypto.randomBytes(6).toString("hex"), ...f, authorId: me.id, authorName: me.name, status: "open", createdAt: Date.now() };
      await kvPipe([["SET", `mission:${m.id}`, JSON.stringify(m)], ["SADD", "missions", m.id]]);
      break;
    }
    case "edit": {
      if (!teacher) return send(res, 403, { error: "teachers_only" });
      const m = await own(b.id); if (!m) return;
      const f = fields({ ...b.mission, type: m.type });
      if (!f) return send(res, 400, { error: "bad_input" });
      if (f.spots < Object.keys(m.joins).length) return send(res, 409, { error: "spots_below_count" });
      const moved = f.date !== m.date || f.time !== m.time || f.where !== m.where;
      Object.assign(m, f, { when: "", updatedAt: Date.now() });
      await save(m);
      if (moved) for (const sid of Object.keys(m.joins))
        tg("sendMessage", { chat_id: sid, text: `📅 Изменение: «${m.title}» — ${m.date}${m.time ? " " + m.time : ""}, ${m.where}` }).catch(() => {});
      break;
    }
    case "delete": {
      if (!teacher) return send(res, 403, { error: "teachers_only" });
      const m = await own(b.id); if (!m) return;
      await kvPipe([["SREM", "missions", m.id], ["DEL", `mission:${m.id}`], ["DEL", `joins:${m.id}`]]);
      for (const [sid, st] of Object.entries(m.joins)) if (st === "joined")
        tg("sendMessage", { chat_id: sid, text: `❌ Отменено: «${m.title}»` }).catch(() => {});
      break;
    }
    case "join": {
      if (!student) return send(res, 403, { error: "students_only" });
      const m = (await loadAll([String(b.id)]))[0];
      if (!m || m.status !== "open") return send(res, 404, { error: "not_found" });
      if (!m.joins[uid]) {
        if (Object.keys(m.joins).length >= m.spots) return send(res, 409, { error: "full" });
        await kvPipe([["HSET", `joins:${m.id}`, uid, "joined"], ["SADD", `uj:${uid}`, m.id]]);
        tg("sendMessage", { chat_id: m.authorId, text: `🙋 ${me.name} (${me.grade}) записался: «${m.title}»` }).catch(() => {});
      }
      break;
    }
    case "confirm": {
      if (!teacher) return send(res, 403, { error: "teachers_only" });
      const m = await own(b.id); if (!m) return;
      const sid = String(b.student);
      if (m.type !== "m" || m.joins[sid] !== "joined") return send(res, 409, { error: "not_joined" });
      const s = await getUser(sid);
      await kvPipe([["HSET", `joins:${m.id}`, sid, "done"], ["INCRBY", `pts:${sid}`, m.gp], ...(s && s.grade ? [["INCRBY", `cls:${s.grade}`, m.gp]] : [])]);
      tg("sendMessage", { chat_id: sid, text: `⚡ +${m.gp} GOOD за «${m.title}». Спасибо! 🙌` }).catch(() => {});
      break;
    }
    case "close": {
      if (!teacher) return send(res, 403, { error: "teachers_only" });
      const m = await own(b.id); if (!m) return;
      m.status = "closed";
      await save(m);
      break;
    }
    case "list": case undefined: break;
    default: return send(res, 400, { error: "bad_action" });
  }

  // Every action answers with the fresh state for this user.
  if (student) {
    const all = await loadAll(await kv("SMEMBERS", "missions"));
    const items = all.filter(m => m.status === "open" || m.joins[uid]).map(m => view(m, uid));
    return send(res, 200, { items, ...(await points(me)) });
  }
  const all = await loadAll(await kv("SMEMBERS", "missions"));
  const mine = all.filter(m => String(m.authorId) === uid);
  const sids = [...new Set(mine.flatMap(m => Object.keys(m.joins)))];
  const users = sids.length ? await kvPipe(sids.map(id => ["GET", `user:${id}`])) : [];
  const names = Object.fromEntries(sids.map((id, i) => { const u = users[i] && JSON.parse(users[i]); return [id, u ? { name: u.name, grade: u.grade, username: u.tg && u.tg.username } : { name: "?", grade: "" }]; }));
  send(res, 200, { mine: mine.map(m => ({ ...view(m, uid), kids: Object.entries(m.joins).map(([id, st]) => ({ id, state: st, ...names[id] })) })) });
};
