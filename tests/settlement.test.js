const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadApi() {
  const now = Date.now();
  let session = {
    id: 'S1', tableId: 'T01', tableName: 'Table 1', startedAt: now - 60000,
    startedAtText: 'start', itemTotal: 38
  };
  const settlements = [];
  const collection = (name) => ({
    where() { return this; },
    limit() { return this; },
    async get() { return { data: session ? [session] : [] }; },
    doc() {
      return {
        async set({ data }) {
          assert.equal(name, 'bar_settlements');
          settlements.push(data);
        },
        async remove() {
          assert.equal(name, 'bar_sessions');
          session = null;
        }
      };
    }
  });
  const db = { runTransaction: async (callback) => callback({ collection }) };
  const cloud = {
    init() {}, database: () => db, getWXContext: () => ({ OPENID: 'admin' })
  };
  const context = {
    exports: {}, require: (id) => id === 'wx-server-sdk' ? cloud : require(id),
    process: { env: { ADMIN_OPENIDS: 'admin' } }
  };
  const file = path.join(__dirname, '..', 'cloudfunctions', 'barApi', 'index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return {
    main: context.exports.main,
    settlements,
    getSession: () => session,
    changeTotal: () => { session.itemTotal += 38; }
  };
}

test('server settles only the displayed session and amount', async () => {
  const api = loadApi();
  const result = await api.main({
    action: 'settleTable', tableId: 'T01', expected: { sessionId: 'S1', totalAmount: 137 }
  });
  assert.equal(result.data.totalAmount, 137);
  assert.equal(api.getSession(), null);
  assert.equal(api.settlements.length, 1);
  await assert.rejects(api.main({
    action: 'settleTable', tableId: 'T01', expected: { sessionId: 'S1', totalAmount: 137 }
  }));
  assert.equal(api.settlements.length, 1);
});

test('changed bill or session is rejected without clearing', async () => {
  for (const expected of [
    { sessionId: 'S1', totalAmount: 99 },
    { sessionId: 'old-session', totalAmount: 137 }
  ]) {
    const api = loadApi();
    await assert.rejects(api.main({ action: 'settleTable', tableId: 'T01', expected }));
    assert.ok(api.getSession());
    assert.equal(api.settlements.length, 0);
  }
});

test('new items after bill display require re-verification', async () => {
  const api = loadApi();
  api.changeTotal();
  await assert.rejects(api.main({
    action: 'settleTable', tableId: 'T01', expected: { sessionId: 'S1', totalAmount: 137 }
  }));
  assert.ok(api.getSession());
  assert.equal(api.settlements.length, 0);
});
