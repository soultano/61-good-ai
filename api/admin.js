// POST {initData} -> pending teachers; POST {initData, id, approve} -> decide. Admins only.
const { auth, isAdmin, listPending, decideTeacher, pub, send } = require("./_lib");

module.exports = async (req, res) => {
  const a = auth(req, res); if (!a) return;
  if (!isAdmin(a.user.id)) return send(res, 403, { error: "not_admin" });
  const { id, approve } = a.body;
  if (id) {
    const u = await decideTeacher(String(id), !!approve, a.user.id);
    if (!u) return send(res, 404, { error: "not_found" });
  }
  const pending = await listPending();
  send(res, 200, { pending: pending.map(u => ({ id: u.id, ...pub(u), username: u.tg.username, createdAt: u.createdAt })) });
};
