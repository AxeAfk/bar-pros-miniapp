const { shop } = require('../../config/app');
const store = require('../../services/store');

Page({
  data: {
    shop,
    tables: []
  },

  onLoad(options) {
    this.resolveEntry(options);
  },

  onShow() {
    this.setData({
      tables: store.getTables().map((table) => ({
        ...table,
        statusText: table.status === 'using' ? '消费中' : '空闲'
      }))
    });
    this.resolveEntry();
  },

  selectTable(event) {
    const tableId = event.currentTarget.dataset.tableId;
    const table = this.data.tables.find((item) => item.id === tableId);
    this.openTable(table);
  },

  resolveEntry(options) {
    const app = getApp();
    const pendingTableId = app.consumeEntryTableId ? app.consumeEntryTableId() : '';
    const queryTableId = options && options.tableId ? options.tableId : '';
    const table = store.getTableById(queryTableId || pendingTableId);

    if (table) {
      this.openTable(table);
      return;
    }

    if (queryTableId || pendingTableId) {
      wx.showToast({
        title: '桌号无效',
        icon: 'none'
      });
    }
  },

  openTable(table) {
    if (!table) {
      return;
    }

    getApp().globalData.selectedTableId = table.id;
    wx.navigateTo({
      url: `/pages/menu/menu?tableId=${table.id}&tableName=${encodeURIComponent(table.name)}`
    });
  },

  goAdmin() {
    wx.switchTab({
      url: '/pages/admin/admin'
    });
  }
});
