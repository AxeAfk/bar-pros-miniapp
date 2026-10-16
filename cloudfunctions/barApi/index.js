const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const commissionRules = require('./commission');

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
  { id: 'p019', name: '香槟', price: 500, onSale: true, commission: { scope: 'designated', rateBps: 3000 } },
  { id: 'p020', name: '轩尼诗VSOP', price: 2500, onSale: true, commission: { scope: 'designated', rateBps: 3000 } },
  { id: 'p021', name: '动力苏打酒', price: 20, onSale: true },
  { id: 'p022', name: '矿泉水', price: 10, onSale: true },
  { id: 'p023', name: '可乐', price: 10, onSale: true }
];
const hourlyServiceFee = 99;
const hourMs = 60 * 60 * 1000;
const adminInviteTtlMs = 30 * 60 * 1000;

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

function createStaffSegment(staffIds, startedAt) {
  return {
    startAt: startedAt,
    startAtText: formatTime(startedAt),
    endAt: null,
    endAtText: '',
    staffIds: commissionRules.normalizeStaffIds(staffIds)
  };
}

function createSessionRecord(table, startedAt, staffIds = []) {
  const normalizedStaffIds = commissionRules.normalizeStaffIds(staffIds);
  return {
    id: createId('S'),
    tableId: table.id,
    tableName: table.name,
    startedAt,
    startedAtText: formatTime(startedAt),
    currentStaffIds: normalizedStaffIds,
    staffSegments: [createStaffSegment(normalizedStaffIds, startedAt)]
  };
}

async function listCollectionDocuments(collectionName, limit = 100) {
  const collection = db.collection(collectionName);
  const documents = [];
  let offset = 0;
  let page = [];
  do {
    const result = await collection.skip(offset).limit(limit).get();
    page = Array.isArray(result.data) ? result.data : [];
    documents.push(...page);
    offset += page.length;
  } while (page.length === limit);
  return documents;
}

function isMissingCollectionError(error) {
  const message = [
    error && error.message,
    error && error.errMsg,
    error && error.code,
    error && error.errCode
  ].filter(Boolean).join(' ');
  return /collection/i.test(message) &&
    /(does not exist|doesn't exist|not exist|not exists|不存在|non[- ]?existent|not found)/i.test(message);
}

function isMissingDocumentError(error) {
  const message = [
    error && error.message,
    error && error.errMsg,
    error && error.code,
    error && error.errCode
  ].filter(Boolean).join(' ');
  return /(document|get).*_id/i.test(message) &&
    /(does not exist|doesn't exist|not exist|not exists|不存在|non[- ]?existent|not found)/i.test(message);
}

function errorMessage(error) {
  if (!error) return '云端请求失败';
  return String(error.message || error.errMsg || error.code || error.errCode || '云端请求失败');
}

function collectionFromError(error) {
  const message = errorMessage(error);
  const match = message.match(/bar_[a-z_]+/i);
  return match ? match[0] : '';
}

function explainCloudError(error) {
  if (isMissingCollectionError(error)) {
    const collection = collectionFromError(error);
    if (collection) {
      return `请先在云开发数据库中创建 ${collection} 集合`;
    }
    return '请先在云开发数据库中创建缺失的集合';
  }
  return errorMessage(error);
}

async function listOptionalCollectionDocuments(collectionName, limit = 100) {
  try {
    return await listCollectionDocuments(collectionName, limit);
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return [];
    }
    throw error;
  }
}

async function getOptionalDocument(collectionName, documentId, transaction) {
  try {
    const result = await (transaction || db).collection(collectionName).doc(documentId).get();
    return result.data || null;
  } catch (error) {
    if (isMissingCollectionError(error) || isMissingDocumentError(error)) {
      return null;
    }
    throw error;
  }
}

async function getEmployeesByIds(employeeIds, transaction) {
  const ids = commissionRules.normalizeStaffIds(employeeIds);
  const employees = [];
  for (const employeeId of ids) {
    const employee = await getOptionalDocument('bar_employees', employeeId, transaction);
    if (employee) employees.push(employee);
  }
  return Object.fromEntries(employees.map((employee) => [employee.id, employee]));
}

function collectSessionEmployeeIds(session, orders) {
  const ids = [];
  const seen = new Set();
  const append = (employeeId) => {
    if (typeof employeeId !== 'string' || !employeeId || seen.has(employeeId)) return;
    seen.add(employeeId);
    ids.push(employeeId);
  };
  (Array.isArray(session.currentStaffIds) ? session.currentStaffIds : []).forEach(append);
  (Array.isArray(session.staffSegments) ? session.staffSegments : []).forEach((segment) => {
    (Array.isArray(segment.staffIds) ? segment.staffIds : []).forEach(append);
  });
  (orders || []).forEach((order) => {
    (order.items || []).forEach((item) => append(item.commission && item.commission.designatedStaffId));
  });
  return ids;
}

function decorateAdminOrders(orders, employeesById) {
  return orders.map((order) => ({
    ...order,
    items: order.items.map((item) => item.commission && item.commission.designatedStaffId
      ? {
        ...item,
        commission: {
          ...item.commission,
          designatedStaffName: employeesById[item.commission.designatedStaffId]
            ? employeesById[item.commission.designatedStaffId].name
            : item.commission.designatedStaffId
        }
      }
      : item)
  }));
}

function getOwnerOpenid() {
  const explicit = String(process.env.OWNER_OPENID || '').trim();
  if (explicit) return explicit;
  return String(process.env.ADMIN_OPENIDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)[0] || '';
}

function isOwner(openid) {
  return Boolean(openid && openid === getOwnerOpenid());
}

async function getAdminMember(openid) {
  if (!openid) return null;
  const member = await getOptionalDocument('bar_admin_members', openid);
  return member && member.status !== 'removed' ? member : null;
}

async function isAdmin(openid) {
  return isOwner(openid) || Boolean(await getAdminMember(openid));
}

async function assertAdmin(openid) {
  if (!await isAdmin(openid)) {
    throw new Error('当前微信账号未获管理员授权');
  }
}

function assertOwner(openid) {
  if (!isOwner(openid)) {
    throw new Error('只有唯一管理员可以管理后台成员');
  }
}

function maskOpenid(openid) {
  const text = String(openid || '');
  if (text.length <= 10) return text;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function randomInviteCode(length = 8) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from(crypto.randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join('');
}

function imageDataUrl(buffer, mimeType = 'image/png') {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function getUnlimitedCodeWithFallback({ page, scene, width }) {
  const attempts = [
    { envVersion: 'release', checkPath: true },
    { envVersion: 'trial', checkPath: false },
    { envVersion: 'develop', checkPath: false }
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const qr = await cloud.openapi.wxacode.getUnlimited({
        page,
        scene,
        envVersion: attempt.envVersion,
        checkPath: attempt.checkPath,
        width
      });
      if (!qr || (qr.errCode && qr.errCode !== 0) || !qr.buffer || typeof qr.buffer.length !== 'number' || !qr.buffer.length) {
        throw new Error(qr && qr.errMsg ? qr.errMsg : '未返回图片');
      }
      return { qr, envVersion: attempt.envVersion, checkPath: attempt.checkPath };
    } catch (error) {
      failures.push(`${attempt.envVersion}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`邀请码二维码生成失败：${failures.join('；')}`);
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
  const summary = commissionRules.summarizeSession(session, orders || [], Date.now(), hourlyServiceFee);
  return {
    ...session,
    ...summary,
    orders: orders || [],
    elapsedText: formatDuration(summary.elapsedMs)
  };
}

function publicOrder(order) {
  const { ownerOpenid, commission, ...visibleOrder } = order;
  return {
    ...visibleOrder,
    items: order.items.map(({ commission: itemCommission, ...item }) => item)
  };
}

async function getSessionOrders(sessionId, admin = false, transaction) {
  const orders = [];
  let offset = 0;
  let page = [];
  do {
    const result = await (transaction || db).collection('bar_orders')
      .where({ sessionId })
      .orderBy('createdAt', 'asc')
      .skip(offset)
      .limit(100)
      .get();
    page = result.data;
    orders.push(...page);
    offset += page.length;
  } while (page.length === 100);
  return admin ? orders : orders.map(publicOrder);
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
  const { commission, ...summary } = summarizeSession(session, orders);
  return summary;
}

async function getDashboard(openid) {
  await assertAdmin(openid);
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
    orders: orderResult.data.map(({ ownerOpenid, ...order }) => order),
    settlements: settlementResult.data
  };
}

async function getTableDetail(tableId, openid) {
  await assertAdmin(openid);
  const normalizedId = normalizeTableId(tableId);
  const session = await getActiveSession(normalizedId);
  if (!session) {
    return null;
  }
  const orders = await getSessionOrders(session.id, true);
  const employeesById = await getEmployeesByIds(collectSessionEmployeeIds(session, orders));
  const summary = commissionRules.summarizeSession(session, orders, Date.now(), hourlyServiceFee, employeesById);
  return {
    ...session,
    ...summary,
    elapsedText: formatDuration(summary.elapsedMs),
    orders: decorateAdminOrders(orders, employeesById),
    currentStaff: (session.currentStaffIds || []).map((employeeId) => ({
      id: employeeId,
      name: employeesById[employeeId] ? employeesById[employeeId].name : employeeId
    }))
  };
}

async function getOrder(orderId, openid) {
  const result = await db.collection('bar_orders').doc(String(orderId || '')).get();
  const order = result.data;
  if (order.ownerOpenid !== openid) {
    await assertAdmin(openid);
  }
  return publicOrder(order);
}

async function submitOrder(event, context) {
  const tableId = normalizeTableId(event.tableId);
  const source = event.source === 'admin' ? 'admin' : 'customer';
  if (source === 'admin') {
    await assertAdmin(context.OPENID);
  }
  if (!tables.some((table) => table.id === tableId)) {
    throw new Error('桌号无效，无法提交订单');
  }
  if (!Array.isArray(event.items) || event.items.length === 0) {
    throw new Error('请先选择商品');
  }

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
      session = createSessionRecord(table, now, []);
    }
    delete session._id;
    const activeStaffIds = Array.isArray(session.currentStaffIds) ? session.currentStaffIds : [];
    const items = event.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId && candidate.onSale);
      const quantity = Number(item.quantity);
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw new Error('订单商品信息无效，请重新选择');
      }
      const config = commissionRules.normalizeProductCommission(product);
      const designatedStaffId = config.scope === 'designated' && activeStaffIds.length === 1
        ? activeStaffIds[0] : '';
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
        commission: commissionRules.itemCommission(product, quantity, designatedStaffId)
      };
    });
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

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

async function updateTableStaff(tableId, staffIds, openid) {
  await assertAdmin(openid);
  const normalizedId = normalizeTableId(tableId);
  if (!tables.some((table) => table.id === normalizedId)) {
    throw new Error('桌号无效');
  }
  const normalizedStaffIds = commissionRules.normalizeStaffIds(staffIds);
  if (!normalizedStaffIds.length) {
    throw new Error('请至少绑定一位在台游戏师');
  }
  return db.runTransaction(async (transaction) => {
    const employeesById = await getEmployeesByIds(normalizedStaffIds, transaction);
    normalizedStaffIds.forEach((employeeId) => {
      if (!employeesById[employeeId] || !employeesById[employeeId].active) {
        throw new Error('请选择有效且在职的游戏师');
      }
    });
    const sessionResult = await transaction.collection('bar_sessions')
      .where({ tableId: normalizedId })
      .limit(1)
      .get();
    let session = sessionResult.data[0] ? { ...sessionResult.data[0] } : null;
    const now = Date.now();
    if (!session) {
      const table = tables.find((entry) => entry.id === normalizedId);
      session = createSessionRecord(table, now, normalizedStaffIds);
    } else {
      delete session._id;
      const current = commissionRules.normalizeStaffIds(Array.isArray(session.currentStaffIds) ? session.currentStaffIds : []);
      if (current.length === normalizedStaffIds.length && current.every((id, index) => id === normalizedStaffIds[index])) {
        return session;
      }
      const segments = Array.isArray(session.staffSegments) && session.staffSegments.length
        ? session.staffSegments.map((segment) => ({
          ...segment,
          staffIds: commissionRules.normalizeStaffIds(segment.staffIds || [])
        }))
        : [createStaffSegment(current, session.startedAt)];
      const last = segments[segments.length - 1];
      if (last.endAt === null || last.endAt === undefined) {
        last.endAt = now;
        last.endAtText = formatTime(now);
      }
      session = {
        ...session,
        currentStaffIds: normalizedStaffIds,
        staffSegments: [...segments, createStaffSegment(normalizedStaffIds, now)]
      };
    }
    await transaction.collection('bar_sessions').doc(normalizedId).set({ data: session });
    return session;
  });
}

async function assignSpecialItem(event, openid) {
  await assertAdmin(openid);
  const tableId = normalizeTableId(event.tableId);
  if (!tables.some((table) => table.id === tableId)) throw new Error('桌号无效');
  if (typeof event.sessionId !== 'string' || !event.sessionId ||
      typeof event.orderId !== 'string' || !event.orderId ||
      !Number.isSafeInteger(event.itemIndex) || event.itemIndex < 0) {
    throw new Error('特殊商品归属参数无效');
  }
  const staffId = typeof event.staffId === 'string' ? event.staffId.trim() : '';
  return db.runTransaction(async (transaction) => {
    const session = await getOptionalDocument('bar_sessions', tableId, transaction);
    if (!session || session.id !== event.sessionId || session.tableId !== tableId) {
      throw new Error('消费场次已变化或已买单，请刷新账单');
    }
    const order = await getOptionalDocument('bar_orders', event.orderId, transaction);
    if (!order || order.tableId !== tableId || order.sessionId !== session.id) {
      throw new Error('订单不属于当前桌台场次');
    }
    const item = Array.isArray(order.items) ? order.items[event.itemIndex] : null;
    if (!item || !item.commission || item.commission.scope !== 'designated') {
      throw new Error('请选择有效的特殊商品');
    }
    const employee = staffId ? await getOptionalDocument('bar_employees', staffId, transaction) : null;
    if (!(session.currentStaffIds || []).includes(staffId) || !employee || !employee.active) {
      throw new Error('请选择当前在台且在职的游戏师');
    }
    const items = order.items.map((entry, index) => index === event.itemIndex
      ? { ...entry, commission: { ...entry.commission, designatedStaffId: staffId } }
      : entry);
    // Share a write conflict with settlement and staff changes, even when totals do not change.
    const { _id, ...sessionData } = session;
    await transaction.collection('bar_sessions').doc(tableId).set({ data: sessionData });
    await transaction.collection('bar_orders').doc(event.orderId).update({ data: { items } });
    return { ...order, items };
  });
}

async function settleTable(tableId, openid, expected) {
  await assertAdmin(openid);
  if (!expected || typeof expected.sessionId !== 'string' || !Number.isFinite(expected.totalAmount)) {
    throw new Error('请先打开买单账单核对金额后再确认收款');
  }
  const normalizedId = normalizeTableId(tableId);
  const now = Date.now();
  return db.runTransaction(async (transaction) => {
    const session = await getOptionalDocument('bar_sessions', normalizedId, transaction);
    if (!session) {
      throw new Error('该桌当前没有进行中的消费');
    }
    const orders = await getSessionOrders(session.id, true, transaction);
    const employeesById = await getEmployeesByIds(collectSessionEmployeeIds(session, orders), transaction);
    const summary = commissionRules.summarizeSession(session, orders, now, hourlyServiceFee, employeesById);
    if (session.id !== expected.sessionId ||
        commissionRules.cents(summary.totalAmount) !== commissionRules.cents(expected.totalAmount)) {
      throw new Error('账单已变化，请重新打开买单账单核对金额后再确认收款');
    }
    if (expected.commissionAmountCents !== summary.commission.amountCents) {
      throw new Error('提成金额已变化，请重新打开买单账单核对');
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
      elapsedMs: summary.elapsedMs,
      elapsedText: formatDuration(summary.elapsedMs),
      itemTotal: summary.itemTotal,
      serviceFee: summary.serviceFee,
      totalAmount: summary.totalAmount,
      currentStaffCount: summary.currentStaffCount,
      staffSegments: summary.staffSegments,
      commission: commissionRules.settleCommission(summary.commission, Object.values(employeesById))
    };
    await transaction.collection('bar_settlements').doc(settlement.id).set({ data: settlement });
    await transaction.collection('bar_sessions').doc(normalizedId).remove();
    return settlement;
  });
}

async function getAdminProfile(openid) {
  const ownerOpenid = getOwnerOpenid();
  return {
    isAdmin: await isAdmin(openid),
    isOwner: isOwner(openid),
    ownerOpenid,
    ownerMaskedOpenid: maskOpenid(ownerOpenid)
  };
}

async function listAdminMembers(openid) {
  await assertAdmin(openid);
  const members = (await listOptionalCollectionDocuments('bar_admin_members'))
    .filter((entry) => entry && entry.status !== 'removed')
    .sort((first, second) => Number(first.joinedAt || 0) - Number(second.joinedAt || 0));

  return [
    {
      openid: getOwnerOpenid(),
      maskedOpenid: maskOpenid(getOwnerOpenid()),
      role: 'owner',
      roleText: '唯一管理员',
      joinedAtText: '环境变量初始化',
      removable: false
    },
    ...members.map((member) => ({
      openid: member.openid,
      maskedOpenid: maskOpenid(member.openid),
      role: 'member',
      roleText: '后台成员',
      joinedAt: member.joinedAt,
      joinedAtText: member.joinedAtText,
      invitedBy: member.invitedBy,
      removable: true
    }))
  ];
}

async function createAdminInvite(openid) {
  assertOwner(openid);
  const code = randomInviteCode();
  const createdAt = Date.now();
  const expiresAt = createdAt + adminInviteTtlMs;
  const invite = {
    code,
    status: 'pending',
    createdBy: openid,
    createdAt,
    createdAtText: formatTime(createdAt),
    expiresAt,
    expiresAtText: formatTime(expiresAt),
    fileID: ''
  };
  await db.collection('bar_admin_invites').doc(code).set({ data: invite });

  const { qr, envVersion } = await getUnlimitedCodeWithFallback({
    page: 'pages/entry/entry',
    scene: `admin_invite=${code}`,
    width: 430
  });
  invite.qrCodeEnvVersion = envVersion;
  invite.qrCodeDataUrl = imageDataUrl(qr.buffer);

  try {
    const uploaded = await cloud.uploadFile({
      cloudPath: `qrcode/admin-invites/${envVersion}/${code}.png`,
      fileContent: qr.buffer
    });
    if (!uploaded || !uploaded.fileID) {
      throw new Error('Cloud upload did not return a fileID');
    }
    const links = await cloud.getTempFileURL({ fileList: [uploaded.fileID] });
    const file = links && links.fileList && links.fileList[0];
    if (!file || file.status !== 0 || !file.tempFileURL) {
      throw new Error(`Download URL unavailable: ${file && file.errMsg ? file.errMsg : 'no URL returned'}`);
    }
    invite.fileID = uploaded.fileID;
    invite.qrCodeUrl = file.tempFileURL;
    await db.collection('bar_admin_invites').doc(code).update({ data: { fileID: uploaded.fileID } });
  } catch (error) {
    console.error('Admin invite QR generation failed', { openid, code, error });
    invite.qrCodeUrl = '';
  }
  if (!invite.qrCodeUrl && !invite.qrCodeDataUrl) {
    throw new Error('邀请码二维码生成失败，请稍后重试');
  }
  return invite;
}

async function acceptAdminInvite(code, openid) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('邀请码无效');
  }
  if (!openid) {
    throw new Error('当前微信账号无效');
  }
  if (isOwner(openid)) {
    return { joined: false, role: 'owner' };
  }
  const existing = await getAdminMember(openid);
  if (existing) {
    return { joined: false, role: 'member' };
  }
  const inviteCode = code.trim().toUpperCase();
  return db.runTransaction(async (transaction) => {
    const inviteDoc = transaction.collection('bar_admin_invites').doc(inviteCode);
    const result = await inviteDoc.get();
    const invite = result.data;
    if (!invite || invite.status !== 'pending') {
      throw new Error('邀请码无效或已失效');
    }
    if (Number(invite.expiresAt) < Date.now()) {
      throw new Error('邀请码已过期');
    }
    const memberDoc = transaction.collection('bar_admin_members').doc(openid);
    const member = {
      openid,
      status: 'active',
      invitedBy: invite.createdBy,
      joinedAt: Date.now(),
      joinedAtText: formatTime(Date.now())
    };
    await memberDoc.set({ data: member });
    await inviteDoc.update({ data: { status: 'used', usedBy: openid, usedAt: Date.now(), usedAtText: formatTime(Date.now()) } });
    return { joined: true, role: 'member' };
  });
}

async function removeAdminMember(targetOpenid, openid) {
  assertOwner(openid);
  if (typeof targetOpenid !== 'string' || !targetOpenid.trim()) {
    throw new Error('后台成员无效');
  }
  const normalized = targetOpenid.trim();
  if (isOwner(normalized)) {
    throw new Error('唯一管理员不能被移除');
  }
  const document = db.collection('bar_admin_members').doc(normalized);
  const result = await document.get();
  if (!result.data || result.data.status === 'removed') {
    throw new Error('后台成员不存在');
  }
  await document.update({ data: { status: 'removed', removedAt: Date.now(), removedAtText: formatTime(Date.now()), removedBy: openid } });
  return { success: true };
}

async function listEmployees(openid) {
  await assertAdmin(openid);
  return (await listOptionalCollectionDocuments('bar_employees'))
    .sort((first, second) => {
      const createdAtDelta = Number(first.createdAt || 0) - Number(second.createdAt || 0);
      if (createdAtDelta) return createdAtDelta;
      return String(first.id || '').localeCompare(String(second.id || ''));
    });
}

async function saveEmployee(input, openid) {
  await assertAdmin(openid);
  const fields = commissionRules.employeeInput(input);
  const now = Date.now();
  const id = input.id || createId('E');
  return db.runTransaction(async (transaction) => {
    let existing = null;
    if (input.id) {
      const result = await transaction.collection('bar_employees').doc(id).get();
      existing = result.data;
      if (!existing) throw new Error('游戏师不存在');
    }
    const employee = {
      id, ...fields, createdAt: existing ? existing.createdAt : now,
      updatedAt: now, updatedBy: openid
    };
    await transaction.collection('bar_employees').doc(id).set({ data: employee });
    return employee;
  });
}

async function listCommissionSettlements(event, openid) {
  await assertAdmin(openid);
  const offset = event.offset === undefined ? 0 : event.offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || !['pending', 'all'].includes(event.filter)) {
    throw new Error('提成记录查询参数无效');
  }
  let query = db.collection('bar_settlements');
  if (event.filter === 'pending') query = query.where({ 'commission.payoutStatus': 'pending' });
  const result = await query.orderBy('closedAt', 'desc').orderBy('id', 'desc')
    .skip(offset).limit(20).get();
  return { records: result.data, nextOffset: offset + result.data.length, hasMore: result.data.length === 20 };
}

async function markCommissionPaid(settlementId, openid) {
  await assertAdmin(openid);
  if (typeof settlementId !== 'string' || !settlementId) throw new Error('买单号无效');
  return db.runTransaction(async (transaction) => {
    const document = transaction.collection('bar_settlements').doc(settlementId);
    const result = await document.get();
    const settlement = result.data;
    if (!settlement || !settlement.commission ||
        !['pending', 'paid'].includes(settlement.commission.payoutStatus)) {
      throw new Error('该买单记录没有待发放提成');
    }
    if (settlement.commission.payoutStatus === 'paid') return settlement;
    const paidAt = Date.now();
    const commission = {
      ...settlement.commission, payoutStatus: 'paid', paidAt,
      paidAtText: formatTime(paidAt), paidBy: openid
    };
    await document.update({ data: { commission } });
    return { ...settlement, commission };
  });
}

exports.main = async (event) => {
  try {
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
        data = await isAdmin(context.OPENID);
        break;
      case 'getAdminProfile':
        data = await getAdminProfile(context.OPENID);
        break;
      case 'listAdminMembers':
        data = await listAdminMembers(context.OPENID);
        break;
      case 'createAdminInvite':
        data = await createAdminInvite(context.OPENID);
        break;
      case 'acceptAdminInvite':
        data = await acceptAdminInvite(event.code, context.OPENID);
        break;
      case 'removeAdminMember':
        data = await removeAdminMember(event.openid, context.OPENID);
        break;
      case 'getOrder':
        data = await getOrder(event.orderId, context.OPENID);
        break;
      case 'submitOrder':
        data = await submitOrder(event, context);
        await require('./order-notifications').notifyWecomRobot(data, process.env.WECOM_WEBHOOK_URL);
        data = publicOrder(data);
        break;
      case 'getDashboard':
        data = await getDashboard(context.OPENID);
        break;
      case 'getTableDetail':
        data = await getTableDetail(event.tableId, context.OPENID);
        break;
      case 'updateTableStaff':
        data = await updateTableStaff(event.tableId, event.staffIds, context.OPENID);
        break;
      case 'assignSpecialItem':
        data = await assignSpecialItem(event, context.OPENID);
        break;
      case 'settleTable':
        data = await settleTable(event.tableId, context.OPENID, event.expected);
        break;
      case 'listEmployees':
        data = await listEmployees(context.OPENID);
        break;
      case 'saveEmployee':
        data = await saveEmployee(event.employee, context.OPENID);
        break;
      case 'listCommissionSettlements':
        data = await listCommissionSettlements(event, context.OPENID);
        break;
      case 'markCommissionPaid':
        data = await markCommissionPaid(event.settlementId, context.OPENID);
        break;
      default:
        throw new Error('未知的云端操作');
    }
    return { success: true, data };
  } catch (error) {
    if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
      console.error('barApi failed', { action: event && event.action, error });
    }
    return { success: false, error: explainCloudError(error) };
  }
};
