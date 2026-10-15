const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(name, store = {}, app = {}) {
  let definition;
  const calls = [];
  const context = {
    module: { exports: {} },
    Page: (page) => { definition = page; },
    require: (id) => id.endsWith('/store') || id === './store' ? store :
      require(path.resolve(name === 'entry' ? path.join(__dirname, '..', 'services') : path.join(__dirname, '..', 'pages', name), id)),
    getApp: () => app,
    setInterval: () => 1,
    clearInterval() {},
    wx: {
      redirectTo: (options) => calls.push({ type: 'redirect', ...options }),
      navigateTo: (options) => calls.push({ type: 'navigate', ...options }),
      showToast: (options) => calls.push({ type: 'toast', ...options }),
      showModal: (options) => calls.push({ type: 'modal', ...options }),
      requestSubscribeMessage: (options) => calls.push({ type: 'subscribe', options }),
      scanCode: (options) => calls.push({ type: 'scan', options })
    }
  };
  const file = name === 'entry' ? path.join(__dirname, '..', 'services', 'entry-page.js') :
    path.join(__dirname, '..', 'pages', name, `${name}.js`);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  if (name === 'entry') definition = context.module.exports;
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) { Object.assign(this.data, values); }
  };
  return { page, calls };
}

test('continue ordering opens the bill table menu, never the table grid', () => {
  const { page, calls } = loadPage('bill');
  page.data.order = { tableId: 'T03' };
  page.continueOrdering();
  assert.equal(calls[0].type, 'redirect');
  assert.equal(calls[0].url, '/pages/menu/menu?tableId=T03');
});

test('continue ordering without a loaded bill reports an error without navigating', () => {
  const { page, calls } = loadPage('bill');
  page.continueOrdering();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'toast');
});

test('scanning replaces the entry page with the bound menu before checking role', async () => {
  const app = { globalData: {}, consumeEntryTableId: () => 'T02' };
  const store = { getTableById: (id) => id === 'T02' ? { id, name: 'Table 2' } : null };
  const { page, calls } = loadPage('entry', store, app);
  await page.resolveEntry();
  assert.equal(calls[0].type, 'redirect');
  assert.equal(calls[0].url, '/pages/menu/menu?tableId=T02');
  assert.equal(app.globalData.selectedTableId, 'T02');
});

test('ordinary customers without a table stay on the scanner page', async () => {
  const { page, calls } = loadPage('entry', {
    isAdmin: () => Promise.resolve(false)
  }, { consumeEntryTableId: () => '' });
  await page.resolveEntry();
  assert.equal(page.data.resolving, false);
  assert.equal(calls.length, 0);
  page.scanTable();
  assert.equal(calls[0].type, 'scan');
  assert.equal(calls[0].options.onlyFromCamera, true);
});

test('administrators without a table go directly to the backend', async () => {
  const { page, calls } = loadPage('entry', {
    isAdmin: () => Promise.resolve(true)
  }, { consumeEntryTableId: () => '' });
  await page.resolveEntry();
  assert.equal(calls[0].url, '/pages/admin/admin');
});

test('scanner recognizes a mini-program path with an encoded scene', () => {
  const app = { globalData: {} };
  const { page, calls } = loadPage('entry', {
    getTableById: (id) => id === 'T06' ? { id } : null
  }, app);
  page.data.resolving = false;
  page.scanTable();
  calls[0].options.success({ path: 'pages/entry/entry?scene=table_id%3D6' });
  assert.equal(calls[1].url, '/pages/menu/menu?tableId=T06');
});

test('invalid table codes do not navigate or select another table', async () => {
  const { page, calls } = loadPage('entry', {
    getTableById: () => null
  }, { consumeEntryTableId: () => '' });
  page.onLoad({ table_id: '99' });
  await page.resolveEntry();
  assert.equal(calls[0].type, 'toast');
  assert.equal(calls.length, 1);
});

test('menu shows all categories together and updates quantities and cart totals', () => {
  const { page } = loadPage('menu');
  page.products = [
    { id: 'beer', categoryId: 'beer', name: 'Beer', price: 38 },
    { id: 'snack', categoryId: 'snack', name: 'Snack', price: 32 }
  ];
  page.cart = {};
  page.refreshProducts();
  assert.equal(page.data.visibleProducts.length, 2);
  assert.equal(page.data.cartCount, 0);
  page.increase({ currentTarget: { dataset: { id: 'snack' } } });
  assert.equal(page.data.visibleProducts[1].quantity, 1);
  assert.equal(page.data.cartCount, 1);
  assert.equal(page.data.cartTotalText, '\u00a532.00');
  page.decrease({ currentTarget: { dataset: { id: 'snack' } } });
  page.decrease({ currentTarget: { dataset: { id: 'snack' } } });
  assert.equal(page.data.cartCount, 0);
  assert.equal(page.data.visibleProducts[1].quantity, 0);
});

test('opening and dismissing a table bill never settles it', async () => {
  let settlements = 0;
  const { page } = loadPage('admin', {
    getTableDetail: async () => ({
      id: 'S1', tableId: 'T01', itemTotal: 38, serviceFee: 99, totalAmount: 137, orders: []
    }),
    settleTable: async () => { settlements += 1; }
  });
  await page.checkout({ currentTarget: { dataset: { tableId: 'T01' } } });
  assert.equal(page.data.tableDetail, null);
  assert.equal(page.data.checkoutBill.totalText, '\u00a5137.00');
  assert.equal(settlements, 0);
  page.closeCheckout();
  assert.equal(page.data.checkoutBill, null);
  assert.equal(settlements, 0);
});

test('checkout overlay is not nested inside selected-table detail', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'pages', 'admin', 'admin.wxml'), 'utf8');
  const stack = [];
  let foundOverlay = false;
  for (const match of template.matchAll(/<\/?[\w-]+\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith('</')) {
      stack.pop();
      continue;
    }
    if (tag.includes('class="checkout-overlay"')) {
      foundOverlay = true;
      assert.equal(stack.length, 1);
      assert.ok(stack.every((ancestor) => !ancestor.includes('wx:if="{{tableDetail}}"')));
    }
    if (!tag.endsWith('/>')) stack.push(tag);
  }
  assert.equal(foundOverlay, true);
  assert.equal(stack.length, 0);
});

test('received-payment confirmation sends the displayed bill and clears the correct table', async () => {
  let settleCalls = 0;
  const { page } = loadPage('admin', {
    settleTable: async (tableId, expected) => {
      settleCalls += 1;
      assert.equal(tableId, 'T01');
      assert.equal(expected.sessionId, 'S1');
      assert.equal(expected.totalAmount, 137);
    }
  });
  page.refresh = async () => true;
  page.data.checkoutBill = { id: 'S1', tableId: 'T01', totalAmount: 137 };
  page.data.tables = [{ id: 'T01', status: 'using' }, { id: 'T02', status: 'using' }];
  const first = page.confirmPayment();
  await page.confirmPayment();
  await first;
  assert.equal(settleCalls, 1);
  assert.equal(page.data.checkoutBill, null);
  assert.equal(page.data.tables[0].status, 'idle');
  assert.equal(page.data.tables[1].status, 'using');
});

test('failed confirmation does not mark the table idle', async () => {
  const { page, calls } = loadPage('admin', {
    settleTable: async () => { throw new Error('Bill changed'); }
  });
  page.data.checkoutBill = { id: 'S1', tableId: 'T01', totalAmount: 137 };
  page.data.tables = [{ id: 'T01', status: 'using' }];
  await page.confirmPayment();
  assert.equal(page.data.tables[0].status, 'using');
  assert.equal(calls[0].type, 'modal');
  assert.equal(page.data.settling, false);
});

test('admin subscription is initiated by a tap and reports consent outcome', () => {
  const { page, calls } = loadPage('admin');
  page.subscribeOrders();
  assert.equal(calls[0].type, 'subscribe');
  const { options } = calls[0];
  assert.equal(options.tmplIds.length, 1);
  options.success({ [options.tmplIds[0]]: 'accept' });
  assert.equal(calls[1].title, '已同意接单提醒');
  options.success({ [options.tmplIds[0]]: 'reject' });
  assert.equal(calls[2].title, '未开启接单提醒');
});

test('menu accumulated spending excludes pending items and resets after clearing', () => {
  const { page } = loadPage('menu');
  page.products = [{ id: 'P1', name: 'Drink', price: 38 }];
  page.cart = {};
  page._sessionStartedAt = Date.now() - 5000;
  page._sessionItemTotal = 76;
  page.updateSessionClock();
  assert.equal(page.data.itemTotalText, '\u00a576.00');
  assert.equal(page.data.serviceFeeText, '\u00a599.00');
  assert.equal(page.data.sessionTotalText, '\u00a5175.00');

  page.increase({ currentTarget: { dataset: { id: 'P1' } } });
  assert.equal(page.data.cartTotalText, '\u00a538.00');
  assert.equal(page.data.sessionTotalText, '\u00a5175.00');

  page._sessionStartedAt = Date.now() - 3605000;
  page.updateSessionClock();
  assert.equal(page.data.serviceFeeText, '\u00a5198.00');
  assert.equal(page.data.sessionTotalText, '\u00a5274.00');

  page._sessionStartedAt = null;
  page._sessionItemTotal = 0;
  page.updateSessionClock();
  assert.equal(page.data.sessionTotalText, '\u00a50.00');
  assert.equal(page.data.sessionActive, false);
  assert.equal(page.data.cartTotalText, '\u00a538.00');
});

test('menu presents accumulated total before products and pending amount in its own dock', () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'pages', 'menu', 'menu.wxml'), 'utf8');
  const summary = markup.slice(0, markup.indexOf('class="list-heading"'));
  const dock = markup.slice(markup.indexOf('class="checkout-dock"'));
  assert.match(summary, /本桌累计消费/);
  assert.match(summary, /\{\{sessionTotalText\}\}/);
  assert.match(summary, /\{\{itemTotalText\}\}/);
  assert.match(summary, /\{\{serviceFeeText\}\}/);
  assert.match(summary, /不含本次待下单商品/);
  assert.doesNotMatch(summary, /\{\{cartTotalText\}\}/);
  assert.match(dock, /本次待下单/);
  assert.match(dock, /\{\{cartTotalText\}\}/);
  assert.doesNotMatch(dock, /\{\{sessionTotalText\}\}/);
});

test('admin refresh formats persisted settlements and preserves the selected records tab', async () => {
  const { page } = loadPage('admin', {
    getDashboard: async () => ({
      stats: { orderCount: 0, revenue: 137 }, tables: [], orders: [],
      settlements: [{
        id: 'C1', tableName: 'Table 1', totalAmount: 137, itemTotal: 38, serviceFee: 99
      }]
    })
  });
  page.selectRecordTab({ currentTarget: { dataset: { tab: 'settlements' } } });
  assert.equal(await page.refresh(), true);
  assert.equal(page.data.recordTab, 'settlements');
  assert.equal(page.data.settlements.length, 1);
  assert.equal(page.data.settlements[0].recordId, 'C1');
  assert.equal(page.data.settlements[0].totalText, '\u00a5137.00');
  assert.equal(page.data.settlements[0].serviceFeeText, '\u00a599.00');
});
