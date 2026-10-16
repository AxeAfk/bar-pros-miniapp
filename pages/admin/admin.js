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
    orders: summary.orders.map(formatOrder)
  };
}

function buildStaffingState(staffing, selectedIds, extra = {}) {
  const normalizedSelectedIds = Array.isArray(selectedIds) ? selectedIds : [];
  const selectedSet = new Set(normalizedSelectedIds);
  const employees = (staffing.employees || []).map((employee) => ({
    ...employee,
    selected: selectedSet.has(employee.id),
    selectedText: selectedSet.has(employee.id) ? '已选' : '未选',
    selectedHint: selectedSet.has(employee.id) ? '再次点击可取消绑定' : '点击选择绑定到当前桌台'
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
      const ownerId = item.commission.designatedStaffId;
      const selectedStaffId = employees.some((entry) => entry.id === ownerId)
        ? ownerId
        : (employees.length === 1 ? employees[0].id : '');
      this.setData({
        specialAssignment: {
          tableId, sessionId, orderId, itemIndex: index,
          tableName: summary.tableName,
          productName: item.name,
          employees,
          selectedStaffId,
          saving: false
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message || '商品归属读取失败', icon: 'none' });
    } finally {
      this.setData({ assignmentLoading: false });
    }
  },

  chooseSpecialOwner(event) {
    const assignment = this.data.specialAssignment;
    if (!assignment || assignment.saving) return;
    const staffId = event.currentTarget.dataset.id;
    if (!assignment.employees.some((entry) => entry.id === staffId)) return;
    this.setData({ specialAssignment: { ...assignment, selectedStaffId: staffId } });
  },

  closeSpecialAssignment() {
    if (this.data.specialAssignment && !this.data.specialAssignment.saving) {
      this.setData({ specialAssignment: null });
    }
  },

  async saveSpecialAssignment() {
    const assignment = this.data.specialAssignment;
    if (!assignment || assignment.saving) return;
    if (!assignment.selectedStaffId) {
      wx.showToast({ title: '请选择归属游戏师', icon: 'none' });
      return;
    }
    this.setData({ specialAssignment: { ...assignment, saving: true } });
    try {
      await store.assignSpecialItem({
        tableId: assignment.tableId,
        sessionId: assignment.sessionId,
        orderId: assignment.orderId,
        itemIndex: assignment.itemIndex,
        staffId: assignment.selectedStaffId
      });
    } catch (error) {
      wx.showToast({ title: error.message || '商品归属保存失败', icon: 'none' });
      this.setData({ specialAssignment: { ...assignment, saving: false } });
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
