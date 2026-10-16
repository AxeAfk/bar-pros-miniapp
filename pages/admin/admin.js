const store = require('../../services/store');
const { formatMoney } = require('../../utils/format');
const { commissionView, itemCommissionText } = require('../../utils/commission-display');

function formatOrder(order) {
  return {
    ...order,
    totalText: formatMoney(order.totalAmount),
    items: order.items.map((item, itemIndex) => ({
      ...item,
      itemIndex,
      commissionText: itemCommissionText(item),
      lineTotalText: formatMoney(item.price * item.quantity),
      unitPriceText: formatMoney(item.price)
    }))
  };
}

function specialAssignmentEntries(order, item, itemIndex, employeesById) {
  if (!item || !item.commission || item.commission.scope !== 'designated') return [];
  const allocations = Array.isArray(item.commission.designatedAllocations) && item.commission.designatedAllocations.length
    ? item.commission.designatedAllocations.map((entry) => ({
      designatedStaffId: entry.staffId || entry.designatedStaffId || '',
      employeeName: entry.designatedStaffName ||
        employeesById[entry.staffId || entry.designatedStaffId] ||
        entry.staffId || entry.designatedStaffId || '',
      quantity: entry.quantity,
      amountCents: entry.amountCents
    }))
    : (item.commission.designatedStaffId
      ? [{
        designatedStaffId: item.commission.designatedStaffId,
        employeeName: item.commission.designatedStaffName || employeesById[item.commission.designatedStaffId] || item.commission.designatedStaffId,
        quantity: item.quantity,
        amountCents: item.commission.amountCents
      }]
      : []);
  const entries = allocations.map((entry) => ({
    designatedStaffId: entry.designatedStaffId,
    employeeName: entry.employeeName || entry.designatedStaffId || '待指定',
    quantity: entry.quantity,
    amountCents: entry.amountCents
  }));
  const assignedQuantity = allocations.reduce((sum, entry) => sum + entry.quantity, 0);
  const assignedAmountCents = allocations.reduce((sum, entry) => sum + entry.amountCents, 0);
  if (assignedQuantity < item.quantity) {
    entries.push({
      designatedStaffId: '',
      employeeName: '待指定',
      quantity: item.quantity - assignedQuantity,
      amountCents: item.commission.amountCents - assignedAmountCents
    });
  }
  return entries.map((entry, segmentIndex) => ({
    entryKey: `${order.id || 'order'}-${itemIndex}-${segmentIndex}`,
    orderId: order.id,
    itemIndex,
    orderCreatedAtText: order.createdAtText || '',
    productId: item.productId,
    name: item.name,
    quantity: entry.quantity,
    designatedStaffId: entry.designatedStaffId,
    employeeName: entry.employeeName,
    amountCents: entry.amountCents,
    amountText: formatMoney(entry.amountCents / 100),
    rateText: `${item.commission.rateBps / 100}%`,
    buttonText: entry.designatedStaffId ? '修改归属' : '指定归属'
  }));
}

function buildSpecialAssignmentSummary(summary) {
  const employeesById = Object.fromEntries(((summary && summary.currentStaff) || []).map((entry) => [entry.id, entry.name]));
  const groups = new Map();
  let totalItemCount = 0;
  let assignedItemCount = 0;
  let unassignedItemCount = 0;
  ((summary && summary.orders) || []).forEach((order) => {
    (order.items || []).forEach((item, itemIndex) => {
      if (!item || !item.commission || item.commission.scope !== 'designated') return;
      specialAssignmentEntries(order, item, itemIndex, employeesById).forEach((entry) => {
        totalItemCount += entry.quantity;
        if (entry.designatedStaffId) {
          assignedItemCount += entry.quantity;
        } else {
          unassignedItemCount += entry.quantity;
        }
        const groupKey = entry.designatedStaffId || '__unassigned__';
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            groupKey,
            designatedStaffId: entry.designatedStaffId,
            employeeName: entry.employeeName,
            itemCount: 0,
            quantityTotal: 0,
            amountCents: 0,
            items: []
          });
        }
        const group = groups.get(groupKey);
        group.itemCount += entry.quantity;
        group.quantityTotal += entry.quantity;
        group.amountCents += entry.amountCents;
        group.items.push(entry);
      });
    });
  });
  return {
    hasSpecialItems: totalItemCount > 0,
    totalItemCount,
    assignedItemCount,
    unassignedItemCount,
    groups: Array.from(groups.values()).map((group) => ({
      ...group,
      amountText: formatMoney(group.amountCents / 100)
    }))
  };
}

function buildSpecialAssignmentState(base, selectedQuantities, extra = {}) {
  const normalized = {};
  let assignedQuantity = 0;
  (base.employees || []).forEach((employee) => {
    const quantity = Math.max(0, Number(selectedQuantities && selectedQuantities[employee.id]) || 0);
    normalized[employee.id] = quantity;
    assignedQuantity += quantity;
  });
  const remainingQuantity = Math.max(0, base.totalQuantity - assignedQuantity);
  return {
    ...base,
    ...extra,
    selectedQuantities: normalized,
    assignedQuantity,
    remainingQuantity,
    employees: (base.employees || []).map((employee) => ({
      ...employee,
      assignedQuantity: normalized[employee.id] || 0,
      quantityText: `${normalized[employee.id] || 0} 件`,
      canDecrease: (normalized[employee.id] || 0) > 0,
      canIncrease: remainingQuantity > 0
    }))
  };
}

function specialOwnerText(item) {
  if (!item || !item.commission) return '待指定';
  const allocations = Array.isArray(item.commission.designatedAllocations)
    ? item.commission.designatedAllocations
    : [];
  if (allocations.length) {
    const names = allocations.map((entry) =>
      `${entry.designatedStaffName || entry.staffId || entry.designatedStaffId} × ${entry.quantity}`);
    const assignedQuantity = allocations.reduce((sum, entry) => sum + entry.quantity, 0);
    const pendingQuantity = Math.max(0, (item.quantity || 0) - assignedQuantity);
    if (pendingQuantity > 0) names.push(`待指定 × ${pendingQuantity}`);
    return names.join('、');
  }
  return item.commission.designatedStaffName || item.commission.designatedStaffId || '待指定';
}

function initialSpecialQuantities(item, employees) {
  const quantities = {};
  (employees || []).forEach((employee) => {
    quantities[employee.id] = 0;
  });
  const allocations = item && item.commission && Array.isArray(item.commission.designatedAllocations)
    ? item.commission.designatedAllocations
    : [];
  if (allocations.length) {
    allocations.forEach((entry) => {
      const staffId = entry.staffId || entry.designatedStaffId;
      if (staffId && quantities[staffId] !== undefined) {
        quantities[staffId] += entry.quantity;
      }
    });
    return quantities;
  }
  const ownerId = item && item.commission ? item.commission.designatedStaffId : '';
  if (ownerId && quantities[ownerId] !== undefined) {
    quantities[ownerId] = item.quantity;
    return quantities;
  }
  if ((employees || []).length === 1) {
    quantities[employees[0].id] = item.quantity;
  }
  return quantities;
}

function formatSummary(summary) {
  return {
    ...summary,
    itemTotalText: formatMoney(summary.itemTotal),
    serviceFeeText: formatMoney(summary.serviceFee),
    totalText: formatMoney(summary.totalAmount),
    currentStaffText: summary.currentStaff && summary.currentStaff.length
      ? summary.currentStaff.map((entry) => entry.name).join('、')
      : '未绑定',
    commissionView: commissionView(summary.commission),
    specialAssignmentSummary: buildSpecialAssignmentSummary(summary),
    orders: summary.orders.map(formatOrder)
  };
}

function buildStaffingState(staffing, selectedIds, extra = {}) {
  const normalizedSelectedIds = Array.isArray(selectedIds) ? selectedIds : [];
  const selectedSet = new Set(normalizedSelectedIds);
  const employees = (staffing.employees || []).map((employee) => ({
    ...employee,
    selected: selectedSet.has(employee.id),
    unavailable: Boolean(employee.currentTableId && employee.currentTableId !== staffing.tableId),
    selectedText: selectedSet.has(employee.id)
      ? '已选'
      : employee.currentTableId && employee.currentTableId !== staffing.tableId
        ? '占用中'
        : '未选',
    selectedHint: selectedSet.has(employee.id)
      ? '再次点击可取消绑定'
      : employee.currentTableId && employee.currentTableId !== staffing.tableId
        ? `当前在 ${employee.currentTableName || employee.currentTableId}，需先从该桌下台`
        : '点击选择绑定到当前桌台'
  }));
  return {
    ...staffing,
    ...extra,
    selectedIds: normalizedSelectedIds,
    selectedNames: employees.filter((employee) => employee.selected).map((employee) => employee.name),
    selectedNamesText: employees.filter((employee) => employee.selected).map((employee) => employee.name).join('、'),
    employees
  };
}

Page({
  data: {
    stats: {
      orderCount: 0,
      revenueText: '¥0.00'
    },
    tables: [],
    orders: [],
    settlements: [],
    recordTab: 'orders',
    selectedTableId: '',
    tableDetail: null,
    checkoutBill: null,
    checkoutLoading: false,
    settling: false,
    showCommission: false,
    staffing: null,
    specialAssignment: null,
    assignmentLoading: false
  },

  onShow() {
    this.refresh().then((loaded) => {
      if (loaded) {
        this.refreshTimer = setInterval(() => this.refresh(), 3000);
      }
    });
  },

  onHide() {
    this.clearRefreshTimer();
  },

  onUnload() {
    this.clearRefreshTimer();
  },

  clearRefreshTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  refresh() {
    if (this.dashboardRequestPending) {
      return Promise.resolve(false);
    }
    this.dashboardRequestPending = true;
    return store.getDashboard().then((snapshot) => {
      const tables = snapshot.tables.map((table) => ({
        ...table,
        statusText: table.status === 'using' ? '占用中' : '空闲',
        totalText: formatMoney(table.totalAmount || 0),
        serviceFeeText: formatMoney(table.serviceFee || 0)
      }));
      const orders = snapshot.orders.map((order) => ({
        ...order,
        statusText: '已下单',
        totalText: formatMoney(order.totalAmount)
      }));
      if (this._hasDashboardSnapshot && orders.some((order) => !this._knownOrderIds.has(order.id))) {
        const newOrder = orders.find((order) => !this._knownOrderIds.has(order.id));
        wx.showToast({ title: `${newOrder.tableName}有新订单`, icon: 'none' });
      }
      this._knownOrderIds = new Set(orders.map((order) => order.id));
      this._hasDashboardSnapshot = true;
      const selected = tables.find((table) => table.id === this.data.selectedTableId);
      const detailRequest = selected && selected.status === 'using'
        ? store.getTableDetail(selected.id)
        : Promise.resolve(null);
      return detailRequest.then((summary) => ({ snapshot, tables, orders, summary }));
    }).then(({ snapshot, tables, orders, summary }) => {
      this.setData({
        stats: {
          orderCount: snapshot.stats.orderCount,
          revenueText: formatMoney(snapshot.stats.revenue)
        },
        tables,
        tableDetail: summary ? formatSummary(summary) : null,
        orders,
        settlements: snapshot.settlements.map((settlement) => ({
          ...settlement,
          recordId: settlement.id || settlement.sessionId,
          totalText: formatMoney(settlement.totalAmount),
          itemTotalText: formatMoney(settlement.itemTotal),
          serviceFeeText: formatMoney(settlement.serviceFee),
          commissionView: commissionView(settlement.commission)
        }))
      });
      this._dashboardErrorShown = false;
      return true;
    }).catch((error) => {
      if (!this._dashboardErrorShown) {
        wx.showToast({ title: error.message || '管理台账读取失败', icon: 'none' });
        this._dashboardErrorShown = true;
      }
      return false;
    }).then((loaded) => {
      this.dashboardRequestPending = false;
      return loaded;
    });
  },

  selectTable(event) {
    this.setData({ selectedTableId: event.currentTarget.dataset.tableId });
    this.refresh();
  },

  selectRecordTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === 'orders' || tab === 'settlements') {
      this.setData({ recordTab: tab });
    }
  },

  addOrder(event) {
    const tableId = event.currentTarget.dataset.tableId;
    const table = store.getTableById(tableId);
    if (!table) {
      wx.showToast({ title: '桌号无效', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/menu/menu?tableId=${encodeURIComponent(table.id)}&source=admin`
    });
  },

  openStaff() {
    wx.navigateTo({ url: '/pages/staff/staff' });
  },

  async openStaffing(event) {
    const tableId = event.currentTarget.dataset.tableId || this.data.selectedTableId;
    const table = this.data.tables.find((entry) => entry.id === tableId) || store.getTableById(tableId);
    if (!table) {
      wx.showToast({ title: '桌号无效', icon: 'none' });
      return;
    }
    try {
      const [employees, summary] = await Promise.all([
        store.listEmployees(),
        table.status === 'using' ? store.getTableDetail(tableId) : Promise.resolve(null)
      ]);
      const activeEmployees = employees.filter((employee) => employee.active);
      const selectedIds = summary && Array.isArray(summary.currentStaff)
        ? summary.currentStaff.map((entry) => entry.id)
        : [];
      this.setData({
        staffing: buildStaffingState({
          tableId,
          tableName: table.name,
          employees: activeEmployees,
          saving: false
        }, selectedIds)
      });
    } catch (error) {
      wx.showToast({ title: error.message || '游戏师列表读取失败', icon: 'none' });
    }
  },

  closeStaffing() {
    if (!this.data.staffing || this.data.staffing.saving) return;
    this.setData({ staffing: null });
  },

  toggleStaffOption(event) {
    const staffing = this.data.staffing;
    if (!staffing || staffing.saving) return;
    const employeeId = event.currentTarget.dataset.id;
    const employee = staffing.employees.find((entry) => entry.id === employeeId);
    if (!employee) return;
    if (employee.unavailable) {
      wx.showToast({
        title: `${employee.name} 当前在 ${employee.currentTableName || employee.currentTableId}`,
        icon: 'none'
      });
      return;
    }
    const selected = staffing.selectedIds.includes(employeeId)
      ? staffing.selectedIds.filter((id) => id !== employeeId)
      : [...staffing.selectedIds, employeeId];
    this.setData({ staffing: buildStaffingState(staffing, selected) });
  },

  async saveStaffing() {
    const staffing = this.data.staffing;
    if (!staffing || staffing.saving) return;
    if (!staffing.selectedIds.length) {
      wx.showToast({ title: '请至少绑定一位在台游戏师', icon: 'none' });
      return;
    }
    this.setData({ staffing: buildStaffingState(staffing, staffing.selectedIds, { saving: true }) });
    try {
      await store.saveTableStaff(staffing.tableId, staffing.selectedIds);
      wx.showToast({ title: '游戏师绑定已更新' });
      this.setData({ staffing: null, selectedTableId: staffing.tableId });
      await this.refresh();
    } catch (error) {
      wx.showToast({ title: error.message || '游戏师绑定失败', icon: 'none' });
      this.setData({ staffing: buildStaffingState(staffing, staffing.selectedIds, { saving: false }) });
    }
  },

  async openSpecialAssignment(event) {
    if (this.data.assignmentLoading || this.data.specialAssignment || this.data.settling) return;
    const { tableId, sessionId, orderId, itemIndex } = event.currentTarget.dataset;
    this.setData({ assignmentLoading: true });
    try {
      const summary = await store.getTableDetail(tableId);
      if (!summary || summary.id !== sessionId) {
        throw new Error('台次已变化，请刷新后重试');
      }
      const order = summary.orders.find((entry) => entry.id === orderId);
      const index = Number(itemIndex);
      const item = order && Number.isSafeInteger(index) && order.items[index];
      if (!item || !item.commission || item.commission.scope !== 'designated') {
        throw new Error('特殊商品信息已变化，请刷新后重试');
      }
      const employees = summary.currentStaff || [];
      const baseAssignment = {
          tableId, sessionId, orderId, itemIndex: index,
          tableName: summary.tableName,
          productName: item.name,
          totalQuantity: item.quantity,
          orderCreatedAtText: order.createdAtText || '',
          orderLabelText: order.createdAtText || '当前订单',
          currentOwnerText: specialOwnerText(item),
          employees,
          saving: false
      };
      this.setData({
        specialAssignment: buildSpecialAssignmentState(baseAssignment, initialSpecialQuantities(item, employees))
      });
    } catch (error) {
      wx.showToast({ title: error.message || '商品归属读取失败', icon: 'none' });
    } finally {
      this.setData({ assignmentLoading: false });
    }
  },

  changeSpecialOwnerQuantity(event) {
    const assignment = this.data.specialAssignment;
    if (!assignment || assignment.saving) return;
    const staffId = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    const employee = assignment.employees.find((entry) => entry.id === staffId);
    if (!employee) return;
    const current = assignment.selectedQuantities[staffId] || 0;
    const next = action === 'increase'
      ? current + 1
      : action === 'decrease'
        ? current - 1
        : current;
    if (next < 0) return;
    if (action === 'increase' && assignment.remainingQuantity < 1) return;
    const selectedQuantities = { ...assignment.selectedQuantities, [staffId]: next };
    this.setData({ specialAssignment: buildSpecialAssignmentState(assignment, selectedQuantities) });
  },

  closeSpecialAssignment() {
    if (this.data.specialAssignment && !this.data.specialAssignment.saving) {
      this.setData({ specialAssignment: null });
    }
  },

  async saveSpecialAssignment() {
    const assignment = this.data.specialAssignment;
    if (!assignment || assignment.saving) return;
    const assignments = Object.keys(assignment.selectedQuantities || {})
      .filter((staffId) => (assignment.selectedQuantities[staffId] || 0) > 0)
      .map((staffId) => ({ staffId, quantity: assignment.selectedQuantities[staffId] }));
    if (!assignments.length) {
      wx.showToast({ title: '请至少为 1 件商品指定归属游戏师', icon: 'none' });
      return;
    }
    this.setData({ specialAssignment: buildSpecialAssignmentState(assignment, assignment.selectedQuantities, { saving: true }) });
    try {
      await store.assignSpecialItem({
        tableId: assignment.tableId,
        sessionId: assignment.sessionId,
        orderId: assignment.orderId,
        itemIndex: assignment.itemIndex,
        assignments
      });
    } catch (error) {
      wx.showToast({ title: error.message || '商品归属保存失败', icon: 'none' });
      this.setData({ specialAssignment: buildSpecialAssignmentState(assignment, assignment.selectedQuantities, { saving: false }) });
      return;
    }
    this.setData({ specialAssignment: null });
    try {
      const summary = await store.getTableDetail(assignment.tableId);
      const updates = {};
      if (this.data.selectedTableId === assignment.tableId) {
        updates.tableDetail = summary ? formatSummary(summary) : null;
      }
      if (this.data.checkoutBill && this.data.checkoutBill.id === assignment.sessionId) {
        updates.checkoutBill = summary && summary.id === assignment.sessionId ? formatSummary(summary) : null;
      }
      this.setData(updates);
      wx.showToast({ title: '特殊商品归属已更新' });
    } catch (error) {
      this.setData({ checkoutBill: null });
      wx.showToast({ title: '归属已保存，账单刷新失败，请重新打开', icon: 'none' });
    }
  },

  async checkout(event) {
    if (this.data.checkoutLoading || this.data.settling) {
      return;
    }
    const tableId = event && event.currentTarget && event.currentTarget.dataset.tableId
      ? event.currentTarget.dataset.tableId
      : this.data.selectedTableId;
    this.setData({ checkoutLoading: true });
    try {
      const summary = await store.getTableDetail(tableId);
      if (!summary) {
        throw new Error('该桌当前没有进行中的消费');
      }
      this.setData({
        showCommission: false,
        checkoutBill: formatSummary(summary)
      });
    } catch (error) {
      wx.showToast({ title: error.message || '账单读取失败', icon: 'none' });
    } finally {
      this.setData({ checkoutLoading: false });
    }
  },

  closeCheckout() {
    if (!this.data.settling) {
      this.setData({ checkoutBill: null });
    }
  },

  closeNothing() {},

  toggleCommission() {
    this.setData({ showCommission: !this.data.showCommission });
  },

  async confirmPayment() {
    const bill = this.data.checkoutBill;
    if (!bill || this.data.settling || this.data.specialAssignment || this.data.assignmentLoading) {
      return;
    }
    if (bill.commission && bill.commission.status !== 'complete') {
      this.setData({ showCommission: true });
      wx.showToast({ title: commissionView(bill.commission).warning || '当前提成还不能结算', icon: 'none' });
      return;
    }
    this.setData({ settling: true });
    try {
      await store.settleTable(bill.tableId, {
        sessionId: bill.id,
        totalAmount: bill.totalAmount,
        commissionAmountCents: bill.commission ? bill.commission.amountCents : 0
      });
      this.setData({
        checkoutBill: null,
        selectedTableId: '',
        tableDetail: null,
        tables: this.data.tables.map((table) => table.id === bill.tableId ? {
          ...table,
          status: 'idle',
          statusText: '空闲',
          elapsedText: '',
          totalAmount: 0,
          totalText: formatMoney(0)
        } : table)
      });
      wx.showToast({ title: '已收款，桌位已清台' });
      await this.refresh();
    } catch (error) {
      wx.showModal({
        title: '未完成清台',
        content: error.message || '结账失败，请重试',
        showCancel: false
      });
      this.setData({ checkoutBill: null });
    } finally {
      this.setData({ settling: false });
    }
  }
});
