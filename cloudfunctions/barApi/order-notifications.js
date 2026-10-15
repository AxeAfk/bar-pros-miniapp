const templateId = 'wO1VECzgDEqinluVIXOxcNb_GLUca7AV2txXiMth0Mk';

async function notifyAdmins(cloud, order, allowlist) {
  const recipients = [...new Set(String(allowlist || '').split(',').map((id) => id.trim()).filter(Boolean))];
  if (!recipients.length) {
    console.error('Order notification has no configured administrators', { orderId: order.id });
  }
  const summary = order.items.map((item) => `${item.name}×${item.quantity}`).join('、');
  const shortText = (value) => Array.from(value).slice(0, 20).join('');
  return Promise.all(recipients.map(async (openid) => {
    try {
      const response = await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId,
        page: 'pages/admin/admin',
        data: {
          thing1: { value: shortText(summary) },
          time2: { value: order.createdAtText },
          thing6: { value: shortText(`${order.tableName}${order.source === 'admin' ? '（代客）' : '顾客'}`) }
        }
      });
      if (response.errCode) {
        throw new Error(`subscribeMessage.send: ${response.errCode} ${response.errMsg || ''}`);
      }
      return { success: true };
    } catch (error) {
      console.error('Order notification failed', { orderId: order.id, openid, error });
      return { success: false };
    }
  }));
}

module.exports = { notifyAdmins };
