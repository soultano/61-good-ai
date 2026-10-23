// POST {initData} -> current user's registration (or null) and admin flag.
const { auth, getUser, isAdmin, pub, send } = require("./_lib");

module.exports = async (req, res) => {
  const a = auth(req, res); if (!a) return;
  const u = await getUser(a.user.id);
  send(res, 200, { user: pub(u), admin: isAdmin(a.user.id) });
};
