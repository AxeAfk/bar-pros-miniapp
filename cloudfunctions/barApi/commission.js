const defaultRateBps = 2000;
const version = 2;
const hourMs = 60 * 60 * 1000;

function sumCents(values) {
  const total = values.reduce((sum, value) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('提成金额数据无效');
    return sum + value;
  }, 0);
  if (!Number.isSafeInteger(total)) throw new Error('提成金额超出计算范围');
  return total;
}

function cents(value) {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw new Error('金额必须为非负数且最多保留两位小数');
  }
  return Math.round(value * 100);
}

function checkRate(rateBps) {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10000) {
    throw new Error('提成比例必须在 0% 至 100% 之间，最多保留两位小数');
  }
  return rateBps;
}

function calculate(amountCents, rateBps) {
  checkRate(rateBps);
  const scaled = amountCents * rateBps;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isSafeInteger(scaled)) {
    throw new Error('提成金额超出计算范围');
  }
  return Math.round(scaled / 10000);
}

function normalizeStaffIds(staffIds) {
  if (!Array.isArray(staffIds)) throw new Error('游戏师列表无效');
  const seen = new Set();
  return staffIds.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('游戏师列表无效');
    return value.trim();
  }).filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function normalizeProductCommission(product) {
  const rule = product && product.commission ? product.commission : null;
  const scope = !rule ? 'shared'
    : rule.scope || (rule.kind === 'special' ? 'designated' : rule.kind === 'default' ? 'shared' : '');
  if (!['shared', 'designated'].includes(scope)) {
    throw new Error('商品提成配置无效');
  }
  return {
    scope,
    rateBps: checkRate(rule && rule.rateBps !== undefined ? rule.rateBps : defaultRateBps)
  };
}

function itemCommission(product, quantity, designatedStaffId) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new Error('商品数量必须为 1 至 99 的整数');
  }
  const { scope, rateBps } = normalizeProductCommission(product);
  const result = {
    version,
    scope,
    rateBps,
    amountCents: calculate(cents(product.price) * quantity, rateBps)
  };
  if (scope === 'designated') {
    if (designatedStaffId !== undefined && designatedStaffId !== null && designatedStaffId !== '') {
      if (typeof designatedStaffId !== 'string' || !designatedStaffId.trim()) {
        throw new Error('特殊商品指定游戏师无效');
      }
      result.designatedStaffId = designatedStaffId.trim();
    }
  }
  return result;
}

function orderCommission(items) {
  const amountCents = sumCents(items.map((item) => item.commission.amountCents));
  return { version, amountCents };
}

function orderTotalCents(order) {
  if (order && Number.isFinite(order.totalAmount)) return cents(order.totalAmount);
  return sumCents((order.items || []).map((item) => cents(item.price) * item.quantity));
}

function ensureAllocation(map, order, employeeId, employeeName) {
  if (!map.has(employeeId)) {
    map.set(employeeId, {
      employeeId,
      employeeName: employeeName || '',
      serviceAmountCents: 0,
      goodsSharedAmountCents: 0,
      specialAmountCents: 0,
      amountCents: 0,
      specialItems: []
    });
  }
  const entry = map.get(employeeId);
  if (!entry.employeeName && employeeName) entry.employeeName = employeeName;
  return entry;
}

function distributeEvenly(amountCents, staffIds, employeesById, target, field) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('提成金额数据无效');
  const ids = normalizeStaffIds(staffIds);
  if (!ids.length) return [];
  const base = Math.floor(amountCents / ids.length);
  let remainder = amountCents - base * ids.length;
  return ids.map((employeeId) => {
    const allocation = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    const record = ensureAllocation(target, null, employeeId, employeesById[employeeId] && employeesById[employeeId].name);
    record[field] += allocation;
    record.amountCents += allocation;
    return { employeeId, amountCents: allocation };
  });
}

function splitByQuantity(amountCents, quantities) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('提成金额数据无效');
  if (!Array.isArray(quantities) || quantities.some((quantity) => !Number.isInteger(quantity) || quantity < 0)) {
    throw new Error('特殊商品数量分配无效');
  }
  const totalQuantity = quantities.reduce((sum, quantity) => sum + quantity, 0);
  if (!totalQuantity) return quantities.map(() => 0);
  const basePerUnit = Math.floor(amountCents / totalQuantity);
  let remainder = amountCents - (basePerUnit * totalQuantity);
  return quantities.map((quantity) => {
    const extra = Math.min(remainder, quantity);
    remainder -= extra;
    return (basePerUnit * quantity) + extra;
  });
}

function normalizeDesignatedAssignments(assignments, totalQuantity) {
  if (!Number.isInteger(totalQuantity) || totalQuantity < 1 || totalQuantity > 99) {
    throw new Error('特殊商品数量必须为 1 至 99 的整数');
  }
  if (assignments === undefined || assignments === null) return [];
  if (!Array.isArray(assignments)) throw new Error('特殊商品归属分配无效');
  const grouped = new Map();
  let assignedQuantity = 0;
  assignments.forEach((entry) => {
    if (!entry || typeof entry.staffId !== 'string' || !entry.staffId.trim() ||
        !Number.isInteger(entry.quantity) || entry.quantity < 1) {
      throw new Error('特殊商品归属分配无效');
    }
    const staffId = entry.staffId.trim();
    assignedQuantity += entry.quantity;
    grouped.set(staffId, (grouped.get(staffId) || 0) + entry.quantity);
  });
  if (assignedQuantity > totalQuantity) {
    throw new Error('特殊商品归属数量超过商品数量');
  }
  return Array.from(grouped.entries()).map(([staffId, quantity]) => ({ staffId, quantity }));
}

function designatedAllocationsForItem(item, commission) {
  if (!commission || commission.scope !== 'designated') return [];
  const quantity = Number(item && item.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('特殊商品数量无效');
  const savedAssignments = normalizeDesignatedAssignments(
    commission.designatedAllocations,
    quantity
  );
  const fallbackAssignments = savedAssignments.length
    ? savedAssignments
    : (commission.designatedStaffId
      ? [{ staffId: commission.designatedStaffId, quantity }]
      : []);
  const allocatedAmounts = splitByQuantity(commission.amountCents, fallbackAssignments.map((entry) => entry.quantity));
  return fallbackAssignments.map((entry, index) => ({
    designatedStaffId: entry.staffId,
    quantity: entry.quantity,
    amountCents: allocatedAmounts[index]
  }));
}

function readOrderItemCommission(item) {
  if (!item || !item.commission) {
    return itemCommission({ price: item.price }, item.quantity);
  }
  const scope = item.commission.scope || (item.commission.kind === 'special' ? 'designated' : 'shared');
  const result = {
    version: item.commission.version || 1,
    scope,
    rateBps: checkRate(item.commission.rateBps === undefined ? defaultRateBps : item.commission.rateBps),
    amountCents: Number.isSafeInteger(item.commission.amountCents)
      ? item.commission.amountCents
      : calculate(cents(item.price) * item.quantity, item.commission.rateBps === undefined ? defaultRateBps : item.commission.rateBps),
    designatedStaffId: item.commission.designatedStaffId || '',
    designatedAllocations: item.commission.designatedAllocations
  };
  if (scope === 'designated') {
    result.designatedAllocations = designatedAllocationsForItem(item, result);
    if (result.designatedAllocations.length === 1 &&
        result.designatedAllocations[0].quantity === item.quantity) {
      result.designatedStaffId = result.designatedAllocations[0].designatedStaffId;
    } else if (result.designatedAllocations.length !== 1) {
      result.designatedStaffId = '';
    }
  }
  return result;
}

function chargeableHours(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error('时长数据无效');
  }
  return Math.max(1, Math.ceil(elapsedMs / hourMs));
}

function serviceSegments(session, now, hourlyServiceFee) {
  const source = Array.isArray(session.staffSegments) && session.staffSegments.length
    ? session.staffSegments
    : [{
      startAt: session.startedAt,
      startAtText: '',
      endAt: null,
      endAtText: '',
      staffIds: Array.isArray(session.currentStaffIds) ? session.currentStaffIds : []
    }];
  const normalizedSegments = source.map((segment, index) => {
    const staffIds = normalizeStaffIds(Array.isArray(segment.staffIds) ? segment.staffIds : []);
    const startAt = Number(segment.startAt) || session.startedAt || now;
    const endAt = segment.endAt === null || segment.endAt === undefined ? now : Number(segment.endAt);
    return {
      index,
      startAt,
      startAtText: segment.startAtText || '',
      endAt,
      endAtText: segment.endAtText || '',
      isOpen: segment.endAt === null || segment.endAt === undefined,
      elapsedMs: Math.max(0, endAt - startAt),
      staffIds,
      staffCount: staffIds.length
    };
  }).sort((first, second) => first.startAt - second.startAt || first.index - second.index);
  let currentStaffCount = 0;
  let currentServiceRateCentsPerHour = 0;
  const participants = [];
  const seen = new Set();
  normalizedSegments.forEach((segment) => {
    if (segment.isOpen) {
      currentStaffCount = segment.staffCount;
      currentServiceRateCentsPerHour = hourlyServiceFee * 100 * segment.staffCount;
    }
    segment.staffIds.forEach((employeeId) => {
      if (!seen.has(employeeId)) {
        seen.add(employeeId);
        participants.push(employeeId);
      }
    });
  });

  const openPeriods = new Map();
  const staffPeriods = [];
  normalizedSegments.forEach((segment) => {
    const activeStaff = new Set(segment.staffIds);
    Array.from(openPeriods.keys()).forEach((employeeId) => {
      if (!activeStaff.has(employeeId)) {
        openPeriods.delete(employeeId);
      }
    });
    segment.staffIds.forEach((employeeId) => {
      const existing = openPeriods.get(employeeId);
      if (existing && existing.endAt === segment.startAt) {
        existing.endAt = segment.endAt;
        existing.endAtText = segment.endAtText;
        return;
      }
      const next = {
        employeeId,
        startAt: segment.startAt,
        startAtText: segment.startAtText,
        endAt: segment.endAt,
        endAtText: segment.endAtText
      };
      staffPeriods.push(next);
      openPeriods.set(employeeId, next);
    });
  });
  const servicePeriods = staffPeriods.map((period) => {
    const elapsedMs = Math.max(0, period.endAt - period.startAt);
    const billedHours = chargeableHours(elapsedMs);
    const feeCents = billedHours * hourlyServiceFee * 100;
    return {
      ...period,
      elapsedMs,
      billedHours,
      serviceFeeCents: feeCents,
      serviceFee: feeCents / 100
    };
  });
  const serviceFeeCents = sumCents(servicePeriods.map((period) => period.serviceFeeCents));
  const segments = normalizedSegments.map((segment) => ({
    startAt: segment.startAt,
    startAtText: segment.startAtText,
    endAt: segment.isOpen ? null : segment.endAt,
    endAtText: segment.endAtText,
    elapsedMs: segment.elapsedMs,
    staffIds: segment.staffIds,
    staffCount: segment.staffCount
  }));
  return {
    segments,
    servicePeriods,
    participantStaffIds: participants,
    currentStaffCount,
    currentServiceRateCentsPerHour,
    serviceFeeCents
  };
}

function calculateServiceFeeCents(session, now, hourlyServiceFee) {
  return serviceSegments(session, now, hourlyServiceFee).serviceFeeCents;
}

function summarizeCommission(session, orders, details, employeesById = {}) {
  const allocationMap = new Map();
  const sharedItems = [];
  const specialItems = [];
  const unassignedItems = [];
  let goodsSharedAmountCents = 0;
  let specialAmountCents = 0;
  const serviceBreakdown = details.servicePeriods.map((period) => {
    const amountCents = calculate(period.serviceFeeCents, defaultRateBps);
    const record = ensureAllocation(allocationMap, null, period.employeeId,
      employeesById[period.employeeId] && employeesById[period.employeeId].name);
    record.serviceAmountCents += amountCents;
    record.amountCents += amountCents;
    return {
      ...period,
      commissionRateBps: defaultRateBps,
      amountCents,
      allocations: [{ employeeId: period.employeeId, amountCents }]
    };
  });

  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const commission = readOrderItemCommission(item);
      const line = {
        orderId: order.id,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        totalAmountCents: cents(item.price) * item.quantity,
        amountCents: commission.amountCents,
        rateBps: commission.rateBps
      };
      if (commission.scope === 'designated') {
        specialAmountCents += commission.amountCents;
        const designatedAllocations = Array.isArray(commission.designatedAllocations)
          ? commission.designatedAllocations
          : [];
        let assignedQuantity = 0;
        let assignedAmountCents = 0;
        designatedAllocations.forEach((allocation) => {
          assignedQuantity += allocation.quantity;
          assignedAmountCents += allocation.amountCents;
          const record = ensureAllocation(allocationMap, order, allocation.designatedStaffId,
            employeesById[allocation.designatedStaffId] && employeesById[allocation.designatedStaffId].name);
          record.specialAmountCents += allocation.amountCents;
          record.amountCents += allocation.amountCents;
          record.specialItems.push({
            orderId: order.id,
            productId: item.productId,
            name: item.name,
            quantity: allocation.quantity,
            amountCents: allocation.amountCents,
            rateBps: commission.rateBps
          });
          specialItems.push({
            ...line,
            quantity: allocation.quantity,
            amountCents: allocation.amountCents,
            designatedStaffId: allocation.designatedStaffId
          });
        });
        if (assignedQuantity < item.quantity) {
          unassignedItems.push({
            ...line,
            quantity: item.quantity - assignedQuantity,
            amountCents: commission.amountCents - assignedAmountCents
          });
        }
        return;
      }
      goodsSharedAmountCents += commission.amountCents;
      sharedItems.push(line);
    });
  });

  if (goodsSharedAmountCents > 0 && details.participantStaffIds.length) {
    distributeEvenly(goodsSharedAmountCents, details.participantStaffIds, employeesById, allocationMap, 'goodsSharedAmountCents');
  }

  const status = unassignedItems.length ? 'pending_special_assignment'
    : goodsSharedAmountCents > 0 && !details.participantStaffIds.length ? 'pending_staff'
      : 'complete';
  const amountCents = sumCents([goodsSharedAmountCents, specialAmountCents,
    sumCents(serviceBreakdown.map((segment) => segment.amountCents))]);
  const allocations = Array.from(allocationMap.values()).map((entry) => ({
    ...entry,
    employeeName: entry.employeeName || entry.employeeId
  }));
  return {
    version,
    status,
    goodsSharedAmountCents,
    specialAmountCents,
    goodsAmountCents: sumCents([goodsSharedAmountCents, specialAmountCents]),
    serviceAmountCents: sumCents(serviceBreakdown.map((segment) => segment.amountCents)),
    amountCents,
    participantStaffIds: details.participantStaffIds,
    currentStaffCount: details.currentStaffCount,
    allocations,
    sharedItems,
    specialItems,
    unassignedItems,
    serviceSegments: serviceBreakdown
  };
}

function summarizeSession(session, orders, now, hourlyServiceFee, employeesById = {}) {
  const details = serviceSegments(session, now, hourlyServiceFee);
  const itemTotalCents = sumCents((orders || []).map(orderTotalCents));
  const commission = summarizeCommission(session, orders || [], details, employeesById);
  return {
    pricedAt: now,
    elapsedMs: Math.max(0, now - session.startedAt),
    itemTotal: itemTotalCents / 100,
    itemTotalCents,
    serviceFee: details.serviceFeeCents / 100,
    serviceFeeCents: details.serviceFeeCents,
    totalAmount: (itemTotalCents + details.serviceFeeCents) / 100,
    totalAmountCents: itemTotalCents + details.serviceFeeCents,
    currentStaffCount: details.currentStaffCount,
    currentServiceRateCentsPerHour: details.currentServiceRateCentsPerHour,
    staffSegments: details.segments,
    participantStaffIds: details.participantStaffIds,
    commission
  };
}

function settleCommission(commission, employees) {
  if (!commission || commission.status !== 'complete') {
    throw new Error(commission && commission.status === 'pending_special_assignment'
      ? '存在未指定归属的特殊商品，请先指定提成游戏师后再结账'
      : '本桌尚未绑定有效游戏师，暂不能完成提成结算');
  }
  const directory = Object.fromEntries((employees || []).map((employee) => [employee.id, employee]));
  return {
    ...commission,
    allocations: commission.allocations.map((entry) => ({
      ...entry,
      employeeName: directory[entry.employeeId] ? directory[entry.employeeId].name : entry.employeeName
    })),
    payoutStatus: commission.amountCents === 0 ? 'not_required' : 'pending'
  };
}

function employeeInput(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() ||
      Array.from(input.name.trim()).length > 30 || typeof input.active !== 'boolean' ||
      (input.id !== undefined && (typeof input.id !== 'string' || !input.id))) {
    throw new Error('游戏师姓名不能为空且最多 30 字，并需指定启用状态');
  }
  return { name: input.name.trim(), active: input.active };
}

module.exports = {
  defaultRateBps,
  cents,
  normalizeStaffIds,
  normalizeProductCommission,
  itemCommission,
  orderCommission,
  normalizeDesignatedAssignments,
  calculateServiceFeeCents,
  summarizeSession,
  summarizeCommission,
  settleCommission,
  employeeInput
};
