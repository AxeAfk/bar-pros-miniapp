const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  notifyWecomRobot,
  notifyWecomHourlyReminder,
  notifyWecomSessionOpened
} = require('../cloudfunctions/barApi/order-notifications');
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
          assert.deepEqual({ ...data }, { ...pricedOrder, tableTotalAmount: 279 });
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
  context.attachTableTotal = async (data) => ({ ...data, tableTotalAmount: 279 });
  const result = await context.exports.main({ action: 'submitOrder' });
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), pricedOrder);
  assert.deepEqual(calls, ['submitted', 'notified']);
  failSubmission = true;
  calls.length = 0;
  const failedResult = await context.exports.main({ action: 'submitOrder' });
  assert.equal(failedResult.success, false);
  assert.deepEqual(calls, []);
});

test('WeCom robot receives a markdown order summary', async () => {
  const calls = [];
  const result = await notifyWecomRobot({ ...pricedOrder, tableTotalAmount: 279 }, ` ${webhook} `, async (url, body) => {
    calls.push({ url, body });
    return { errcode: 0, errmsg: 'ok' };
  });
  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, webhook);
  assert.equal(calls[0].body.msgtype, 'markdown');
  const content = calls[0].body.markdown.content;
  for (const text of ['1号桌', '顾客扫码', order.createdAtText, '百威啤酒 ×2　¥50', '科罗娜 ×1　¥30', '本单合计：<font color="warning">¥80', '本桌当前消费合计：<font color="warning">¥279']) {
    assert.ok(content.includes(text), text);
  }
  calls.length = 0;
  await notifyWecomRobot(pricedOrder, webhook, async (url, body) => {
    calls.push({ url, body });
    return { errcode: 0 };
  });
  assert.ok(!calls[0].body.markdown.content.includes('本桌当前消费合计'));
});

test('WeCom robot receives a full-hour table reminder', async () => {
  const calls = [];
  const session = {
    tableId: 'T01',
    tableName: '1号桌',
    startedAtText: '2026-10-16 10:00'
  };
  const result = await notifyWecomHourlyReminder(session, 2, '2026-10-16 12:00', webhook, async (url, body) => {
    calls.push({ url, body });
    return { errcode: 0 };
  });
  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, webhook);
  assert.equal(calls[0].body.msgtype, 'markdown');
  const content = calls[0].body.markdown.content;
  for (const text of ['1号桌', session.startedAtText, '已开台：', '2 小时', '2026-10-16 12:00']) {
    assert.ok(content.includes(text), text);
  }
});

test('WeCom robot receives a table-opened notification', async () => {
  const calls = [];
  const session = {
    tableId: 'T01',
    tableName: '1号桌',
    startedAtText: '2026-10-16 10:00',
    currentStaffIds: ['E1', 'E2'],
    staffNames: ['阿杰', '小美']
  };
  const result = await notifyWecomSessionOpened(session, webhook, async (url, body) => {
    calls.push({ url, body });
    return { errcode: 0 };
  });
  assert.deepEqual(result, { success: true });
  assert.equal(calls[0].url, webhook);
  const content = calls[0].body.markdown.content;
  for (const text of ['新开台通知', '1号桌', session.startedAtText, '当前在台游戏师：阿杰，小美']) {
    assert.ok(content.includes(text), text);
  }
  assert.ok(!content.includes('位'));
  calls.length = 0;
  await notifyWecomSessionOpened({ ...session, currentStaffIds: [], staffNames: [] }, webhook, async (url, body) => {
    calls.push({ url, body });
    return { errcode: 0 };
  });
  assert.ok(calls[0].body.markdown.content.includes('当前在台游戏师：未绑定'));
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
