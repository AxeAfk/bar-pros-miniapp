const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const tables = Array.from({ length: 6 }, (_, index) => {
  const number = index + 1;
  const tableCode = String(number).padStart(2, '0');
  return {
    id: `T${tableCode}`,
    name: `${number}号桌`,
    area: '大厅',
    status: 'idle'
  };
});
const products = [
  { id: 'p001', name: '百威啤酒', price: 25, onSale: true },
  { id: 'p002', name: '科罗娜', price: 30, onSale: true },
  { id: 'p012', name: '福佳白', price: 30, onSale: true },
  { id: 'p013', name: '百威铝罐', price: 40, onSale: true },
  { id: 'p014', name: '青岛铝罐', price: 40, onSale: true },
  { id: 'p015', name: '诱惑1号', price: 50, onSale: true },
  { id: 'p016', name: '诱惑7号', price: 50, onSale: true },
  { id: 'p017', name: '诱惑9号', price: 50, onSale: true },
  { id: 'p018', name: '1664白啤', price: 50, onSale: true },
  { id: 'p019', name: '香槟', price: 500, onSale: true },
  { id: 'p020', name: '轩尼诗VSOP', price: 2500, onSale: true },
  { id: 'p021', name: '动力苏打酒', price: 20, onSale: true },
  { id: 'p022', name: '矿泉水', price: 10, onSale: true },
  { id: 'p023', name: '可乐', price: 10, onSale: true }
];
const hourlyServiceFee = 99;
const hourMs = 60 * 60 * 1000;

function normalizeTableId(value) {
  const input = String(value || '').trim().toUpperCase();
  if (/^\d{1,2}$/.test(input)) {
    return `T${input.padStart(2, '0')}`;
  }
  return input;
}

function createId(prefix) {
  return `${prefix}${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function serviceFeeFor(startedAt, now) {
  const elapsedMs = Math.max(0, now - startedAt);
  const billableHours = Math.max(1, Math.ceil(elapsedMs / hourMs));
  return {
    elapsedMs,
    elapsedText: formatDuration(elapsedMs),
    billableHours,
    serviceFee: billableHours * hourlyServiceFee
  };
}

function assertAdmin(openid) {
  if (!isAdmin(openid)) {
    throw new Error('当前微信账号未获管理员授权');
  }
}

function isAdmin(openid) {
  const allowedOpenIds = String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return Boolean(openid && allowedOpenIds.includes(openid));
}

async function ensureTables() {
  const collection = db.collection('bar_tables');
  const result = await collection.limit(100).get();
  const storedById = new Map(result.data.map((table) => [table.id, table]));
  const tablesToWrite = tables.filter((table) => {
    const storedTable = storedById.get(table.id);
    return !storedTable || storedTable.name !== table.name || storedTable.area !== table.area;
  });
  await Promise.all(tablesToWrite.map((table) => collection.doc(table.id).set({ data: table })));
  return tables;
}

async function getActiveSession(tableId) {
  const result = await db.collection('bar_sessions')
    .where({ tableId: normalizeTableId(tableId) })
    .limit(1)
    .get();
  return result.data[0] || null;
}

function summarizeSession(session, orders) {
  if (!session) {
    return null;
  }
  const now = Date.now();
  const charges = serviceFeeFor(session.startedAt, now);
  const itemTotal = Number(session.itemTotal || 0);
  return {
    ...session,
    orders: orders || [],
    ...charges,
    itemTotal,
    totalAmount: itemTotal + charges.serviceFee
  };
}

function publicOrder(order) {
  const { ownerOpenid, ...visibleOrder } = order;
  return visibleOrder;
}

async function getSessionOrders(sessionId) {
  const orders = [];
  let offset = 0;
  let page = [];
  do {
    const result = await db.collection('bar_orders')
      .where({ sessionId })
      .orderBy('createdAt', 'asc')
      .skip(offset)
      .limit(100)
      .get();
    page = result.data;
    orders.push(...page);
    offset += page.length;
  } while (page.length === 100);
  return orders.map(publicOrder);
}

async function getTodaySettlements(startedToday) {
  const settlements = [];
  let offset = 0;
  let page = [];
  do {
    const result = await db.collection('bar_settlements')
      .where({ closedAt: db.command.gte(startedToday) })
      .skip(offset)
      .limit(100)
      .get();
    page = result.data;
    settlements.push(...page);
    offset += page.length;
  } while (page.length === 100);
  return settlements;
}

async function listTables() {
  const storedTables = await ensureTables();
  const sessionResult = await db.collection('bar_sessions').limit(100).get();
  const activeByTable = new Map(sessionResult.data.map((session) => [session.tableId, session]));
  return storedTables.map((table) => ({
    ...table,
    status: activeByTable.has(table.id) ? 'using' : 'idle'
  }));
}

async function getCustomerSession(tableId, sessionId) {
  const session = await getActiveSession(normalizeTableId(tableId));
  if (!session || (sessionId && session.id !== sessionId)) {
    return null;
  }
  const orders = await getSessionOrders(session.id);
  return summarizeSession(session, orders);
}

async function getDashboard(openid) {
  assertAdmin(openid);
  const [storedTables, sessionResult, orderResult, settlementResult] = await Promise.all([
    ensureTables(),
    db.collection('bar_sessions').limit(100).get(),
    db.collection('bar_orders').orderBy('createdAt', 'desc').limit(10).get(),
    db.collection('bar_settlements').orderBy('closedAt', 'desc').limit(10).get()
  ]);
  const sessionByTable = new Map(sessionResult.data.map((session) => [session.tableId, session]));
  const tablesWithSummary = storedTables.map((table) => {
    const session = sessionByTable.get(table.id);
    const summary = summarizeSession(session);
    return {
      ...table,
      status: summary ? 'using' : 'idle',
      sessionId: summary ? summary.id : '',
      startedAt: summary ? summary.startedAt : null,
      elapsedText: summary ? summary.elapsedText : '',
      itemTotal: summary ? summary.itemTotal : 0,
      serviceFee: summary ? summary.serviceFee : 0,
      totalAmount: summary ? summary.totalAmount : 0
    };
  });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [orderCount, settlements] = await Promise.all([
    db.collection('bar_orders')
      .where({ createdAt: db.command.gte(start.getTime()) })
      .count(),
    getTodaySettlements(start.getTime())
  ]);
  const activeTotal = tablesWithSummary.reduce((sum, table) => sum + table.totalAmount, 0);
  const settledTotal = settlements.reduce((sum, settlement) => sum + settlement.totalAmount, 0);
  return {
    stats: {
      orderCount: orderCount.total,
      revenue: activeTotal + settledTotal
    },
    tables: tablesWithSummary,
    orders: orderResult.data.map(publicOrder),
    settlements: settlementResult.data
  };
}

async function getTableDetail(tableId, openid) {
  assertAdmin(openid);
  const normalizedId = normalizeTableId(tableId);
  const session = await getActiveSession(normalizedId);
  if (!session) {
    return null;
  }
  const orders = await getSessionOrders(session.id);
  return summarizeSession(session, orders);
}

async function getOrder(orderId, openid) {
  const result = await db.collection('bar_orders').doc(String(orderId || '')).get();
  const order = result.data;
  if (order.ownerOpenid !== openid) {
    assertAdmin(openid);
  }
  return publicOrder(order);
}

async function submitOrder(event, context) {
  const tableId = normalizeTableId(event.tableId);
  const source = event.source === 'admin' ? 'admin' : 'customer';
  if (source === 'admin') {
    assertAdmin(context.OPENID);
  }
  if (!tables.some((table) => table.id === tableId)) {
    throw new Error('桌号无效，无法提交订单');
  }
  if (!Array.isArray(event.items) || event.items.length === 0) {
    throw new Error('请先选择商品');
  }

  const items = event.items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId && candidate.onSale);
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error('订单商品信息无效，请重新选择');
    }
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity
    };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const now = Date.now();
  const orderId = createId('O');
  await ensureTables();

  return db.runTransaction(async (transaction) => {
    const tableResult = await transaction.collection('bar_tables')
      .where({ id: tableId })
      .limit(1)
      .get();
    const table = tableResult.data[0];
    if (!table) {
      throw new Error('桌台尚未初始化，请先检查云端数据集合');
    }

    const existingResult = await transaction.collection('bar_sessions')
      .where({ tableId })
      .limit(1)
      .get();
    let session = existingResult.data[0] ? { ...existingResult.data[0] } : null;
    if (!session) {
      session = {
        id: createId('S'),
        tableId,
        tableName: table.name,
        startedAt: now,
        startedAtText: formatTime(now),
        itemTotal: 0
      };
    }
    delete session._id;
    session = {
      ...session,
      itemTotal: Number(session.itemTotal || 0) + totalAmount
    };

    const order = {
      id: orderId,
      sessionId: session.id,
      tableId,
      tableName: table.name,
      items,
      totalAmount,
      source,
      status: 'submitted',
      createdAt: now,
      createdAtText: formatTime(now),
      ownerOpenid: context.OPENID
    };
    await transaction.collection('bar_sessions').doc(tableId).set({ data: session });
    await transaction.collection('bar_orders').doc(orderId).set({ data: order });
    return order;
  });
}

async function settleTable(tableId, openid, expected) {
  assertAdmin(openid);
  if (!expected || typeof expected.sessionId !== 'string' || !Number.isFinite(expected.totalAmount)) {
    throw new Error('请先打开买单账单核对金额后再确认收款');
  }
  const normalizedId = normalizeTableId(tableId);
  const now = Date.now();
  return db.runTransaction(async (transaction) => {
    const sessionResult = await transaction.collection('bar_sessions')
      .where({ tableId: normalizedId })
      .limit(1)
      .get();
    const session = sessionResult.data[0];
    if (!session) {
      throw new Error('该桌当前没有进行中的消费');
    }

    const charges = serviceFeeFor(session.startedAt, now);
    const itemTotal = Number(session.itemTotal || 0);
    if (session.id !== expected.sessionId || itemTotal + charges.serviceFee !== expected.totalAmount) {
      throw new Error('账单已变化，请重新打开买单账单核对金额后再确认收款');
    }
    const settlement = {
      id: createId('C'),
      sessionId: session.id,
      tableId: normalizedId,
      tableName: session.tableName,
      startedAt: session.startedAt,
      startedAtText: session.startedAtText,
      closedAt: now,
      closedAtText: formatTime(now),
      elapsedMs: charges.elapsedMs,
      elapsedText: charges.elapsedText,
      billableHours: charges.billableHours,
      itemTotal,
      serviceFee: charges.serviceFee,
      totalAmount: itemTotal + charges.serviceFee
    };
    await transaction.collection('bar_settlements').doc(settlement.id).set({ data: settlement });
    await transaction.collection('bar_sessions').doc(normalizedId).remove();
    return settlement;
  });
}

exports.main = async (event) => {
  const context = cloud.getWXContext();
  let data;
  switch (event.action) {
    case 'listTables':
      data = await listTables();
      break;
    case 'getCustomerSession':
      data = await getCustomerSession(event.tableId, event.sessionId);
      break;
    case 'isAdmin':
      data = isAdmin(context.OPENID);
      break;
    case 'getOrder':
      data = await getOrder(event.orderId, context.OPENID);
      break;
    case 'submitOrder':
      data = await submitOrder(event, context);
      await require('./order-notifications').notifyAdmins(cloud, data, process.env.ADMIN_OPENIDS);
      break;
    case 'getDashboard':
      data = await getDashboard(context.OPENID);
      break;
    case 'getTableDetail':
      data = await getTableDetail(event.tableId, context.OPENID);
      break;
    case 'settleTable':
      data = await settleTable(event.tableId, context.OPENID, event.expected);
      break;
    default:
      throw new Error('未知的云端操作');
  }
  return { success: true, data };
};
