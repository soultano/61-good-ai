// Telegram webhook: /start opens the Mini App; admins approve/reject teachers via inline buttons.
const { webhookSecret, readBody, tg, isAdmin, decideTeacher, send } = require("./_lib");

module.exports = async (req, res) => {
  if (req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret()) return send(res, 401, { ok: false });
  const up = readBody(req);
  const appUrl = `https://${req.headers.host}/tg`;
  try {
    if (up.message && /^\/start/.test(up.message.text || "")) {
      await tg("sendMessage", { chat_id: up.message.chat.id,
        text: "Привет! Это 61 GOOD AI — кружки, события и GOOD-миссии школы №61.\nSalom! 61 GOOD AI — 61-maktabning to‘garaklari, tadbirlari va GOOD-missiyalari.",
        reply_markup: { inline_keyboard: [[{ text: "🚀 Открыть 61 GOOD AI", web_app: { url: appUrl } }]] } });
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
