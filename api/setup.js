// GET /api/setup — points the bot's webhook and menu button at this deployment. Safe to re-run.
const { BOT_TOKEN, tg, webhookSecret, send, storage, ADMIN_IDS } = require("./_lib");

module.exports = async (req, res) => {
  if (!BOT_TOKEN) return send(res, 500, { error: "BOT_TOKEN is not set" });
  const base = `https://${req.headers.host}`;
  const webhook = await tg("setWebhook", { url: `${base}/api/bot`, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"] });
  const menu = await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "61 GOOD AI", web_app: { url: `${base}/tg` } } });
  const me = await tg("getMe", {});
  send(res, 200, { bot: me.result && me.result.username, webhook, menu, storage, admins: ADMIN_IDS.length });
};
