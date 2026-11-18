// Telegram webhook: /start opens the Mini App; admins approve/reject teachers via inline buttons.
const { webhookSecret, readBody, tg, kv, isAdmin, decideTeacher, send } = require("./_lib");

module.exports = async (req, res) => {
  if (req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret()) return send(res, 401, { ok: false });
  const up = readBody(req);
  const appUrl = `https://${req.headers.host}/tg`;
  try {
    if (up.message && /^\/start/.test(up.message.text || "")) {
      // Invite links look like t.me/goodaiuz_bot?start=m_<id>: open the Mini App straight on that mission.
      const id = ((up.message.text || "").match(/^\/start m_([0-9a-f]{12})$/) || [])[1];
      const raw = id && await kv("GET", `mission:${id}`);
      const m = raw && JSON.parse(raw);
      await tg("sendMessage", { chat_id: up.message.chat.id,
        text: m ? `📌 ${m.title}\n📅 ${m.date || m.when || ""}${m.time ? " " + m.time : ""} · ${m.where}\n\nОткройте, чтобы записаться · Yozilish uchun oching`
          : "Привет! Это 61 GOOD AI — кружки, события и GOOD-миссии школы №61.\nSalom! 61 GOOD AI — 61-maktabning to‘garaklari, tadbirlari va GOOD-missiyalari.",
        reply_markup: { inline_keyboard: [[{ text: m ? "👉 Открыть и записаться" : "🚀 Открыть 61 GOOD AI", web_app: { url: m ? `${appUrl}?m=${m.id}` : appUrl } }]] } });
    }
    const cq = up.callback_query;
    if (cq && /^(ap|rj):\d+$/.test(cq.data || "")) {
      if (!isAdmin(cq.from.id)) {
        await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Только для администратора", show_alert: true });
      } else {
        const [act, id] = cq.data.split(":");
        const u = await decideTeacher(id, act === "ap", cq.from.id);
        const status = !u ? "не найден" : u.status === "active" ? "✅ одобрен" : u.status === "rejected" ? "❌ отклонён" : u.status;
        await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `Учитель ${status}` });
        await tg("editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id,
          text: `${cq.message.text}\n\nРешение: ${status} (${cq.from.first_name})` });
      }
    }
  } catch (e) { console.error(e); }
  send(res, 200, { ok: true });
};
