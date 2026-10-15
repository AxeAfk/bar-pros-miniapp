const wecomWebhookPrefix = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=';

function postJson(url, body, timeoutMs = 5000) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const request = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`WeCom webhook returned HTTP ${response.statusCode}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('WeCom webhook timed out')));
    request.on('error', reject);
    request.end(payload);
  });
}

function buildWecomMarkdown(order) {
  const lines = order.items.map((item) => `> ${item.name} ×${item.quantity}　¥${item.price * item.quantity}`);
  return [
    `## 新订单 · ${order.tableName}`,
    `来源：<font color="comment">${order.source === 'admin' ? '代客下单' : '顾客扫码'}</font>`,
    `时间：<font color="comment">${order.createdAtText}</font>`,
    ...lines,
    `本单合计：<font color="warning">¥${order.totalAmount}</font>`
  ].join('\n');
}

async function notifyWecomRobot(order, webhookUrl, post = postJson) {
  const url = String(webhookUrl || '').trim();
  if (!url) {
    return { success: false, skipped: true };
  }
  try {
    if (!url.startsWith(wecomWebhookPrefix)) {
      throw new Error('WECOM_WEBHOOK_URL is not a WeCom robot webhook');
    }
    const response = await post(url, { msgtype: 'markdown', markdown: { content: buildWecomMarkdown(order) } });
    if (!response || response.errcode !== 0) {
      throw new Error(`WeCom webhook: ${response && response.errcode} ${(response && response.errmsg) || ''}`);
    }
    return { success: true };
  } catch (error) {
    console.error('WeCom order notification failed', { orderId: order.id, error: error.message });
    return { success: false };
  }
}

module.exports = { notifyWecomRobot, buildWecomMarkdown };
