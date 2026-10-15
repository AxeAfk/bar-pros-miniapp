const store = require('../../services/store');
const { formatMoney } = require('../../utils/format');
const { orderNotificationTemplateId } = require('../../config/app');

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
    settling: false
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

  subscribeOrders() {
    wx.requestSubscribeMessage({
      tmplIds: [orderNotificationTemplateId],
      success: (result) => {
        wx.showModal({
          title: result[orderNotificationTemplateId] === 'accept' ? '已同意接单提醒' : '未开启接单提醒',
          content: result[orderNotificationTemplateId] === 'accept'
            ? '若为一次性模板，本次订阅仅增加一次通知机会。请在额度用完前再次点击订阅；“总是允许”不代表无限次接收。'
            : '请允许订阅该模板。若此前拒收，可在小程序设置中调整后重新订阅。',
          showCancel: false
        });
      },
      fail: (error) => {
        console.error('Order subscription failed', error);
        wx.showToast({ title: '订阅失败，请检查模板配置与微信设置', icon: 'none' });
      }
    });
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
        totalText: formatMoney(table.totalAmount || 0)
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
      return detailRequest.then((summary) => ({
        stats: snapshot.stats,
        tables,
        orders,
        settlements: snapshot.settlements,
        summary
      }));
    }).then((snapshot) => {
      const summary = snapshot.summary;
      const tableDetail = summary ? {
        ...summary,
        itemTotalText: formatMoney(summary.itemTotal),
        serviceFeeText: formatMoney(summary.serviceFee),
        totalText: formatMoney(summary.totalAmount),
        orders: summary.orders.map((order) => ({
          ...order,
          totalText: formatMoney(order.totalAmount),
          items: order.items.map((item) => ({
            ...item,
            lineTotalText: formatMoney(item.price * item.quantity),
            unitPriceText: formatMoney(item.price)
          }))
        }))
      } : null;
      this.setData({
        stats: {
          orderCount: snapshot.stats.orderCount,
          revenueText: formatMoney(snapshot.stats.revenue)
        },
        tables: snapshot.tables,
        tableDetail,
        orders: snapshot.orders,
        settlements: snapshot.settlements.map((settlement) => ({
          ...settlement,
          recordId: settlement.id || settlement.sessionId,
          totalText: formatMoney(settlement.totalAmount),
          itemTotalText: formatMoney(settlement.itemTotal),
          serviceFeeText: formatMoney(settlement.serviceFee)
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
        checkoutBill: {
          ...summary,
          itemTotalText: formatMoney(summary.itemTotal),
          serviceFeeText: formatMoney(summary.serviceFee),
          totalText: formatMoney(summary.totalAmount),
          orders: summary.orders.map((order) => ({
            ...order,
            items: order.items.map((item) => ({
              ...item,
              unitPriceText: formatMoney(item.price),
              lineTotalText: formatMoney(item.price * item.quantity)
            }))
          }))
        }
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

  async confirmPayment() {
    const bill = this.data.checkoutBill;
    if (!bill || this.data.settling) {
      return;
    }
    this.setData({ settling: true });
    try {
      await store.settleTable(bill.tableId, {
        sessionId: bill.id,
        totalAmount: bill.totalAmount
      });
      this.setData({
        checkoutBill: null,
        selectedTableId: '',
        tableDetail: null,
        tables: this.data.tables.map((table) => table.id === bill.tableId ? {
          ...table, status: 'idle', statusText: '空闲', elapsedText: '', totalAmount: 0, totalText: formatMoney(0)
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
