// POST {initData, role, name, grade?, subject?, interests?}
// Students are active right away; teachers wait for an administrator.
const { auth, getUser, saveUser, kv, tg, isAdmin, ADMIN_IDS, pub, send } = require("./_lib");

const LETTERS = "АБВГДЕЖЗИКЛМНОПРСТ";
const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "method" });
  const a = auth(req, res); if (!a) return;
  const { user: tgUser, body } = a;
  const role = body.role === "teacher" ? "teacher" : body.role === "student" ? "student" : null;
  const name = clean(body.name, 60);
  if (!role || name.length < 2) return send(res, 400, { error: "bad_input" });

  const old = await getUser(tgUser.id);
  // One registration per Telegram account; a rejected teacher may still join as a student.
  if (old && !(old.status === "rejected" && role === "student")) return send(res, 409, { error: "already_registered", user: pub(old) });

  const u = { id: tgUser.id, role, name, createdAt: Date.now(),
    tg: { username: tgUser.username || null, first_name: tgUser.first_name || "", last_name: tgUser.last_name || "" } };
  if (role === "student") {
    const num = parseInt(body.grade, 10), letter = clean(body.letter, 1).toUpperCase();
    if (!(num >= 1 && num <= 11) || !LETTERS.includes(letter) || !letter) return send(res, 400, { error: "bad_grade" });
    u.grade = `${num}-${letter}`;
    u.interests = (Array.isArray(body.interests) ? body.interests : []).map(Number).filter(i => i >= 0 && i < 8).slice(0, 8);
    u.status = "active";
  } else {
    u.subject = clean(body.subject, 60);
    if (u.subject.length < 2) return send(res, 400, { error: "bad_subject" });
    u.status = isAdmin(tgUser.id) ? "active" : "pending";
  }
  await saveUser(u);
  await kv("SADD", "users", u.id);

  if (u.status === "pending") {
    await kv("SADD", "pending_teachers", u.id);
    const who = `${u.name}${u.tg.username ? " (@" + u.tg.username + ")" : ""}`;
    await Promise.all(ADMIN_IDS.map(id => tg("sendMessage", {
      chat_id: id,
      text: `🧑‍🏫 Новая заявка учителя\n\n${who}\nПредмет: ${u.subject}\nTelegram ID: ${u.id}\n\nПодтвердите, только если это действительно учитель школы №61.`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Одобрить", callback_data: `ap:${u.id}` }, { text: "❌ Отклонить", callback_data: `rj:${u.id}` }]] }
    }).catch(() => {})));
  }
  send(res, 200, { user: pub(u), admin: isAdmin(tgUser.id) });
};
