const assert = require('node:assert/strict');
const { test } = require('node:test');
const { notifyWecomRobot } = require('../cloudfunctions/barApi/order-notifications');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const order = {
  id: 'O1', tableName: '1号桌', source: 'customer',
  createdAtText: '2026-10-16 00:25',
  items: [{ name: '百威啤酒', quantity: 2 }, { name: '科罗娜', quantity: 1 }]
};

const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';
const pricedOrder = {
  ...order, totalAmount: 80,
  items: [{ name: '百威啤酒', price: 25, quantity: 2 }, { name: '科罗娜', price: 30, quantity: 1 }]
};

test('order dispatch only awaits the robot after successful submission', async () => {
  const calls = [];
  const cloud = { init() {}, database: () => ({}), getWXContext: () => ({ OPENID: 'admin' }) };
  let failSubmission = false;
  const context = vm.createContext({
    exports: {},
    process: { env: { ADMIN_OPENIDS: 'admin', WECOM_WEBHOOK_URL: webhook } },
    require: (id) => {
      if (id === 'wx-server-sdk') return cloud;
      if (id === './order-notifications') return {
        notifyWecomRobot: async (data, url) => {
          assert.equal(data, pricedOrder);
          assert.equal(url, webhook);
          assert.deepEqual(calls, ['submitted']);
          await Promise.resolve();
          calls.push('notified');
          return { success: false };
        }
      };
      return require(id.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'barApi', id) : id);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cloudfunctions', 'barApi', 'index.js'), 'utf8'), context);
  context.submitOrder = async () => {
    if (failSubmission) throw new Error('Submission failed');
    calls.push('submitted');
    return pricedOrder;
  };
  const result = await context.exports.main({ action: 'submitOrder' });
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), pricedOrder);
  assert.deepEqual(calls, ['submitted', 'notified']);
  failSubmission = true;
  calls.length = 0;
  await assert.rejects(context.exports.main({ action: 'submitOrder' }), /Submission failed/);
  assert.deepEqual(calls, []);
});

test('WeCom robot receives a markdown order summary', async () => {
  const calls = [];
  const result = await notifyWecomRobot(pricedOrder, ` ${webhook} `, async (url, body) => {
    calls.push({ url, body });
    return { errcode: 0, errmsg: 'ok' };
  });
  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, webhook);
  assert.equal(calls[0].body.msgtype, 'markdown');
  const content = calls[0].body.markdown.content;
  for (const text of ['1号桌', '顾客扫码', order.createdAtText, '百威啤酒 ×2　¥50', '科罗娜 ×1　¥30', '¥80']) {
    assert.ok(content.includes(text), text);
  }
});

test('WeCom robot is skipped when unconfigured and failures never throw', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let called = false;
  const post = async () => { called = true; return { errcode: 0 }; };
  assert.deepEqual(await notifyWecomRobot(pricedOrder, '', post), { success: false, skipped: true });
  assert.deepEqual(await notifyWecomRobot(pricedOrder, 'https://evil.example/hook', post), { success: false });
  assert.equal(called, false);
  assert.deepEqual(await notifyWecomRobot(pricedOrder, webhook, async () => ({ errcode: 93000, errmsg: 'invalid key' })), { success: false });
  assert.deepEqual(await notifyWecomRobot(pricedOrder, webhook, async () => { throw new Error('timeout'); }), { success: false });
  assert.equal(logs.length, 3);
});
