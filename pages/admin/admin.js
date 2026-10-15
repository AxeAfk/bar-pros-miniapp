const store = require('../../services/store');
const { formatMoney } = require('../../utils/format');
const { commissionView, itemCommissionText } = require('../../utils/commission-display');

function formatOrder(order) {
  return {
    ...order,
    totalText: formatMoney(order.totalAmount),
    items: order.items.map((item) => ({
      ...item,
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
    staffing: null
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
        staffing: {
          tableId,
          tableName: table.name,
          selectedIds,
          employees: activeEmployees,
          saving: false
        }
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
    this.setData({ staffing: { ...staffing, selectedIds: selected } });
  },

  async saveStaffing() {
    const staffing = this.data.staffing;
    if (!staffing || staffing.saving) return;
    if (!staffing.selectedIds.length) {
      wx.showToast({ title: '请至少绑定一位在台游戏师', icon: 'none' });
      return;
    }
    this.setData({ staffing: { ...staffing, saving: true } });
    try {
      await store.saveTableStaff(staffing.tableId, staffing.selectedIds);
      wx.showToast({ title: '游戏师绑定已更新' });
      this.setData({ staffing: null, selectedTableId: staffing.tableId });
      await this.refresh();
    } catch (error) {
      wx.showToast({ title: error.message || '游戏师绑定失败', icon: 'none' });
      this.setData({ staffing: { ...staffing, saving: false } });
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
    if (!bill || this.data.settling) {
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
