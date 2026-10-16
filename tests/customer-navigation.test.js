const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage(name, store = {}, app = {}) {
  store = {
    listEmployees: async () => [],
    getAdminProfile: async () => ({ isAdmin: true, isOwner: false, ownerMaskedOpenid: '' }),
    listAdminMembers: async () => [],
    ...store
  };
  let definition;
  const calls = [];
  const context = {
    module: { exports: {} },
    Page: (page) => { definition = page; },
    require: (id) => id.endsWith('/store') || id === './store' ? store :
      require(path.resolve(name === 'entry' ? path.join(__dirname, '..', 'services') : path.join(__dirname, '..', 'pages', name), id)),
    getApp: () => app,
    setInterval: () => 1,
    setTimeout: () => 1,
    clearInterval() {},
    wx: {
      redirectTo: (options) => calls.push({ type: 'redirect', ...options }),
      navigateTo: (options) => calls.push({ type: 'navigate', ...options }),
      navigateBack: (options) => calls.push({ type: 'navigateBack', ...(options || {}) }),
      showToast: (options) => calls.push({ type: 'toast', ...options }),
      showModal: (options) => calls.push({ type: 'modal', ...options }),
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

test('admin invite scan accepts membership and redirects to backend', async () => {
  let accepted = '';
  const { page, calls } = loadPage('entry', {
    acceptAdminInvite: async (code) => { accepted = code; },
    isAdmin: () => Promise.resolve(false)
  }, { consumeEntryTableId: () => '' });
  page.onLoad({ admin_invite: 'INV12345' });
  await page.resolveEntry();
  assert.equal(accepted, 'INV12345');
  assert.equal(calls[1].url, '/pages/admin/admin');
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
      id: 'S1', tableId: 'T01', tableName: '1号桌', itemTotal: 38, serviceFee: 99, totalAmount: 137,
      currentStaff: [{ id: 'A', name: 'Alice' }], orders: [],
      commission: { status: 'complete', amountCents: 2000, goodsAmountCents: 1000, goodsSharedAmountCents: 1000, specialAmountCents: 0, serviceAmountCents: 1000, allocations: [] }
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
  page.data.checkoutBill = {
    id: 'S1', tableId: 'T01', totalAmount: 137,
    commission: { status: 'complete', amountCents: 16980 }
  };
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
  page.data.checkoutBill = {
    id: 'S1', tableId: 'T01', totalAmount: 137,
    commission: { status: 'complete', amountCents: 16980 }
  };
  page.data.tables = [{ id: 'T01', status: 'using' }];
  await page.confirmPayment();
  assert.equal(page.data.tables[0].status, 'using');
  assert.equal(calls[0].type, 'modal');
  assert.equal(page.data.settling, false);
});

test('admin has no subscription entry and still displays new-order toasts', async () => {
  let orders = [];
  const { page, calls } = loadPage('admin', {
    getDashboard: async () => ({ stats: {}, tables: [], orders, settlements: [] })
  });
  const template = fs.readFileSync(path.join(__dirname, '..', 'pages', 'admin', 'admin.wxml'), 'utf8');
  assert.equal(page.subscribeOrders, undefined);
  assert.doesNotMatch(template, /subscribeOrders|订阅/);
  assert.equal(await page.refresh(), true);
  assert.equal(calls.length, 0);
  orders = [{ id: 'O1', tableName: 'Table 1', totalAmount: 80 }];
  assert.equal(await page.refresh(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'toast');
  assert.equal(calls[0].title, 'Table 1有新订单');
  await page.refresh();
  assert.equal(calls.length, 1);
});

test('menu accumulated spending uses hourly service-fee steps and resets after clearing', () => {
  const { page } = loadPage('menu');
  page.products = [{ id: 'P1', name: 'Drink', price: 38 }];
  page.cart = {};
  const now = Date.now();
  page._liveSession = {
    startedAt: now - (59 * 60 * 1000),
    itemTotal: 76,
    itemTotalCents: 7600,
    staffSegments: [{ startAt: now - (59 * 60 * 1000), endAt: null, staffIds: ['A'] }]
  };
  page.updateSessionClock();
  assert.equal(page.data.itemTotalText, '\u00a576.00');
  assert.equal(page.data.serviceFeeText, '\u00a599.00');
  assert.equal(page.data.sessionTotalText, '\u00a5175.00');

  page.increase({ currentTarget: { dataset: { id: 'P1' } } });
  assert.equal(page.data.cartTotalText, '\u00a538.00');
  assert.equal(page.data.sessionTotalText, '\u00a5175.00');

  page._liveSession.startedAt = now - (61 * 60 * 1000);
  page._liveSession.staffSegments[0].startAt = now - (61 * 60 * 1000);
  page.updateSessionClock();
  assert.equal(page.data.serviceFeeText, '\u00a5198.00');
  assert.equal(page.data.sessionTotalText, '\u00a5274.00');

  page._liveSession = null;
  page._sessionStartedAt = null;
  page._sessionItemTotalCents = 0;
  page._serviceFeeBaseCents = 0;
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

test('checkout previews auto-computed commission and blocks incomplete commission states', async () => {
  const settlements = [];
  const { page, calls } = loadPage('admin', {
    getTableDetail: async () => ({
      id: 'S1', tableId: 'T01', tableName: '1号桌', itemTotal: 500, serviceFee: 99, totalAmount: 599,
      currentStaff: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }],
      orders: [],
      commission: {
        status: 'pending_special_assignment',
        goodsAmountCents: 15000,
        goodsSharedAmountCents: 5000,
        specialAmountCents: 10000,
        serviceAmountCents: 1980,
        amountCents: 16980,
        allocations: [{
          employeeId: 'A',
          employeeName: 'Alice',
          amountCents: 6980,
          serviceAmountCents: 1980,
          goodsSharedAmountCents: 5000,
          specialAmountCents: 0,
          specialItems: []
        }],
        specialItems: [{ productId: 'p019', name: '香槟', quantity: 1, amountCents: 10000, rateBps: 3000, designatedStaffId: 'B' }],
        unassignedItems: [{ name: '香槟', amountCents: 10000 }]
      }
    }),
    settleTable: async (...args) => { settlements.push(args); }
  });
  await page.checkout({ currentTarget: { dataset: { tableId: 'T01' } } });
  assert.equal(page.data.checkoutBill.totalText, '\u00a5599.00');
  assert.equal(page.data.checkoutBill.commissionView.amountText, '\u00a5169.80');
  assert.equal(page.data.checkoutBill.commissionView.specialItems[0].name, '香槟');
  assert.equal(page.data.checkoutBill.commissionView.specialItems[0].rateText, '30%');
  assert.equal(page.data.checkoutBill.commissionView.specialItems[0].amountText, '\u00a5100.00');
  await page.confirmPayment();
  assert.equal(settlements.length, 0);
  assert.equal(page.data.showCommission, true);
  assert.ok(calls.some((entry) => entry.type === 'toast'));
});

test('staffing sheet updates a table assignment', async () => {
  const saved = [];
  const { page, calls } = loadPage('admin', {
    listEmployees: async () => [{ id: 'A', name: 'Alice', active: true }, { id: 'B', name: 'Bob', active: true }],
    saveTableStaff: async (tableId, staffIds) => saved.push({ tableId, staffIds }),
    getDashboard: async () => ({
      stats: { orderCount: 0, revenue: 0 },
      tables: [{ id: 'T01', name: '1号桌', status: 'idle', totalAmount: 0 }],
      orders: [],
      settlements: []
    })
  });
  await page.refresh();
  await page.openStaffing({ currentTarget: { dataset: { tableId: 'T01' } } });
  page.toggleStaffOption({ currentTarget: { dataset: { id: 'A' } } });
  assert.equal(page.data.staffing.selectedIds.join(','), 'A');
  assert.equal(page.data.staffing.employees[0].selected, true);
  assert.equal(page.data.staffing.employees[0].selectedText, '已选');
  assert.equal(page.data.staffing.selectedNamesText, 'Alice');
  page.toggleStaffOption({ currentTarget: { dataset: { id: 'A' } } });
  assert.equal(page.data.staffing.selectedIds.length, 0);
  assert.equal(page.data.staffing.employees[0].selected, false);
  assert.equal(page.data.staffing.selectedNamesText, '');
  page.toggleStaffOption({ currentTarget: { dataset: { id: 'A' } } });
  await page.saveStaffing();
  assert.equal(JSON.stringify(saved[0]), JSON.stringify({ tableId: 'T01', staffIds: ['A'] }));
  assert.ok(calls.some((entry) => entry.title === '游戏师绑定已更新'));

});

test('customer and admin menus submit special products without attribution controls or checks', async () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'pages', 'menu', 'menu.wxml'), 'utf8');
  assert.doesNotMatch(template, /提成|特殊商品|specialStaff|specialCommission|chooseSpecial/);
  for (const source of ['customer', 'admin']) {
    const submitted = [];
    const { page, calls } = loadPage('menu', {
      getTableById: () => ({ id: 'T01', name: '1号桌' }),
      getMenu: () => ({ products: [{ id: 'p019', name: '香槟', price: 500, commission: { scope: 'designated', rateBps: 3000 } }] }),
      getCustomerSession: async () => null,
      submitOrder: async (order) => { submitted.push(order); return { id: 'O1' }; }
    });
    page.onLoad({ tableId: 'T01', source });
    page.increase({ currentTarget: { dataset: { id: 'p019' } } });
    await page.submitOrder();
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].source, source);
    assert.equal(JSON.stringify(submitted[0].items), JSON.stringify([{ productId: 'p019', quantity: 1 }]));
    assert.equal(page.data.cartCount, 0);
    assert.equal(page.data.submitting, false);
    assert.ok(calls.some((entry) => source === 'admin' ? entry.title === '代客下单成功' : entry.type === 'navigate'));
  }
});

function specialSummary(staff = [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]) {
  return {
    id: 'S1', tableId: 'T01', tableName: '1号桌',
    itemTotal: 1000, serviceFee: 0, totalAmount: 1000, currentStaff: staff,
    orders: [{
      id: 'O1', totalAmount: 1000,
      items: [0, 1].map(() => ({
        productId: 'p019', name: '香槟', quantity: 1, price: 500,
        commission: { scope: 'designated', rateBps: 3000, amountCents: 15000 }
      }))
    }]
  };
}

const specialEvent = {
  currentTarget: { dataset: { tableId: 'T01', sessionId: 'S1', orderId: 'O1', itemIndex: 1 } }
};

test('admin selects and saves special ownership for the exact order line and refreshes bill', async () => {
  const summary = specialSummary();
  const saved = [];
  const { page, calls } = loadPage('admin', {
    getTableDetail: async () => summary,
    assignSpecialItem: async (assignment) => {
      saved.push(assignment);
      summary.orders[0].items[1].commission.designatedStaffId = assignment.staffId;
    }
  });
  page.data.selectedTableId = 'T01';
  page.data.checkoutBill = summary;
  await page.openSpecialAssignment(specialEvent);
  assert.equal(page.data.specialAssignment.selectedStaffId, '');
  await page.saveSpecialAssignment();
  assert.equal(saved.length, 0);
  page.chooseSpecialOwner({ currentTarget: { dataset: { id: 'B' } } });
  await page.saveSpecialAssignment();
  assert.equal(JSON.stringify(saved[0]), JSON.stringify({
    tableId: 'T01', sessionId: 'S1', orderId: 'O1', itemIndex: 1, staffId: 'B'
  }));
  assert.equal(page.data.specialAssignment, null);
  assert.equal(page.data.checkoutBill.orders[0].items[1].commission.designatedStaffId, 'B');
  assert.equal(page.data.tableDetail.orders[0].items[0].commission.designatedStaffId, undefined);
  assert.ok(calls.some((entry) => entry.title === '特殊商品归属已更新'));
});

test('admin special ownership defaults sole staff, supports cancel and preserves input on failure', async () => {
  const { page, calls } = loadPage('admin', {
    getTableDetail: async () => specialSummary([{ id: 'A', name: 'Alice' }]),
    assignSpecialItem: async () => { throw new Error('游戏师已变更'); }
  });
  await page.openSpecialAssignment(specialEvent);
  assert.equal(page.data.specialAssignment.selectedStaffId, 'A');
  await page.saveSpecialAssignment();
  assert.equal(page.data.specialAssignment.selectedStaffId, 'A');
  assert.equal(page.data.specialAssignment.saving, false);
  assert.ok(calls.some((entry) => entry.title === '游戏师已变更'));
  page.closeSpecialAssignment();
  assert.equal(page.data.specialAssignment, null);
});

test('special ownership handles empty staff and stale sessions without saving', async () => {
  const summary = specialSummary([]);
  const { page, calls } = loadPage('admin', { getTableDetail: async () => summary });
  await page.openSpecialAssignment(specialEvent);
  assert.equal(page.data.specialAssignment.employees.length, 0);
  await page.saveSpecialAssignment();
  assert.ok(calls.some((entry) => entry.title === '请选择归属游戏师'));
  page.closeSpecialAssignment();
  summary.id = 'S2';
  await page.openSpecialAssignment(specialEvent);
  assert.equal(page.data.specialAssignment, null);
  assert.ok(calls.some((entry) => entry.title === '台次已变化，请刷新后重试'));
});

test('special ownership prevents duplicate writes and checkout while saving', async () => {
  let finish;
  let saves = 0;
  let settlements = 0;
  const summary = specialSummary([{ id: 'A', name: 'Alice' }]);
  const { page } = loadPage('admin', {
    getTableDetail: async () => summary,
    assignSpecialItem: () => { saves += 1; return new Promise((resolve) => { finish = resolve; }); },
    settleTable: async () => { settlements += 1; }
  });
  page.data.checkoutBill = summary;
  await page.openSpecialAssignment(specialEvent);
  const saving = page.saveSpecialAssignment();
  await page.saveSpecialAssignment();
  page.closeSpecialAssignment();
  await page.confirmPayment();
  assert.equal(saves, 1);
  assert.equal(settlements, 0);
  assert.equal(page.data.specialAssignment.saving, true);
  finish();
  await saving;
  assert.equal(page.data.specialAssignment, null);
});

test('saved ownership is not reported as a failed write when bill refresh fails', async () => {
  let saved = false;
  const summary = specialSummary([{ id: 'A', name: 'Alice' }]);
  const { page, calls } = loadPage('admin', {
    getTableDetail: async () => {
      if (saved) throw new Error('network unavailable');
      return summary;
    },
    assignSpecialItem: async () => { saved = true; }
  });
  page.data.checkoutBill = summary;
  await page.openSpecialAssignment(specialEvent);
  await page.saveSpecialAssignment();
  assert.equal(saved, true);
  assert.equal(page.data.specialAssignment, null);
  assert.equal(page.data.checkoutBill, null);
  assert.equal(calls.at(-1).title, '归属已保存，账单刷新失败，请重新打开');
});

test('staff editor saves names and inactive state, reports failures without dismissing input', async () => {
  const saved = [];
  let fail = false;
  const { page, calls } = loadPage('staff', {
    saveEmployee: async (employee) => {
      if (fail) throw new Error('Permission denied');
      saved.push(employee);
    },
    listEmployees: async () => [{ id: 'A', name: 'Alice', active: true }]
  });
  page.newEmployee();
  page.editName({ detail: { value: 'Alice' } });
  await page.saveEmployee();
  assert.equal(saved[0].name, 'Alice');
  assert.equal(saved[0].active, true);
  assert.equal(page.data.editor, null);
  page.editEmployee({ currentTarget: { dataset: { id: 'A' } } });
  page.editActive({ detail: { value: false } });
  fail = true;
  await page.saveEmployee();
  assert.equal(page.data.editor.active, false);
  assert.equal(page.data.saving, false);
  assert.ok(calls.some((entry) => entry.title === 'Permission denied'));
  fail = false;
  await page.saveEmployee();
  assert.equal(saved[1].id, 'A');
  assert.equal(saved[1].active, false);
});

test('staff route is registered and all admin/staff template handlers exist', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  assert.ok(config.pages.includes('pages/staff/staff'));
  for (const name of ['admin', 'staff']) {
    const { page } = loadPage(name);
    const template = fs.readFileSync(path.join(__dirname, '..', 'pages', name, `${name}.wxml`), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)[a-z]+="(\w+)"/g)) {
      assert.equal(typeof page[match[1]], 'function', `${name}: ${match[1]}`);
    }
    if (name === 'staff') {
      assert.doesNotMatch(template, /提成发放记录|已线下发放/);
      assert.match(template, /游戏师管理/);
    }
  }
});

test('staff page owners can generate invite QR and remove joined admin members', async () => {
  const removed = [];
  const { page, calls } = loadPage('staff', {
    getAdminProfile: async () => ({ isAdmin: true, isOwner: true, ownerMaskedOpenid: 'owne…1234' }),
    listAdminMembers: async () => [
      { openid: 'owner', maskedOpenid: 'owne…1234', roleText: '唯一管理员', removable: false },
      { openid: 'member1', maskedOpenid: 'memb…5678', roleText: '后台成员', removable: true, joinedAtText: '2026-10-16 03:00' }
    ],
    createAdminInvite: async () => ({
      code: 'INV12345',
      expiresAtText: '2026-10-16 03:30',
      qrCodeUrl: 'https://example.invalid/invite.png'
    }),
    removeAdminMember: async (openid) => removed.push(openid),
    listEmployees: async () => []
  });
  await page.onShow();
  assert.equal(page.data.adminProfile.isOwner, true);
  await page.createInvite();
  assert.equal(page.data.invite.code, 'INV12345');
  assert.ok(calls.some((entry) => entry.title === '邀请码已生成'));
  const removing = page.removeAdminMember({ currentTarget: { dataset: { id: 'member1' } } });
  calls.at(-1).success({ confirm: true });
  await removing;
  assert.equal(removed[0], 'member1');
  assert.equal(page.data.records, undefined);
});

test('staff page can display invite QR from inline image data', async () => {
  const { page } = loadPage('staff', {
    getAdminProfile: async () => ({ isAdmin: true, isOwner: true, ownerMaskedOpenid: 'owne…1234' }),
    listAdminMembers: async () => [],
    createAdminInvite: async () => ({
      code: 'INV12345',
      expiresAtText: '2026-10-16 03:30',
      qrCodeDataUrl: 'data:image/png;base64,ZmFrZQ==',
      qrCodeEnvVersion: 'trial'
    }),
    listEmployees: async () => []
  });
  await page.onShow();
  await page.createInvite();
  assert.equal(page.data.invite.code, 'INV12345');
  assert.equal(page.data.invite.qrCodeImage, 'data:image/png;base64,ZmFrZQ==');
  assert.equal(page.data.invite.qrCodeEnvVersion, 'trial');
});
