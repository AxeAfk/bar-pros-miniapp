const store = require('./store');
const { getEntryTableId } = require('../utils/entry');

module.exports = {
  data: {
    resolving: true,
    scanning: false,
    message: '正在识别入口…'
  },

  onLoad(options) {
    this.entryOptions = options || {};
  },

  onShow() {
    return this.resolveEntry();
  },

  async resolveEntry() {
    if (this.routing || this.data.scanning) {
      return;
    }
    this.routing = true;
    this.setData({ resolving: true });
    try {
      const app = getApp();
      const pendingTableId = app.consumeEntryTableId();
      const tableId = getEntryTableId(this.entryOptions) || pendingTableId;
      this.entryOptions = {};
      if (tableId) {
        this.openTable(tableId);
        return;
      }
      if (await store.isAdmin()) {
        this.redirect('/pages/admin/admin');
      } else {
        this.setData({ message: '请扫一扫桌面上的二维码，进入本桌点单' });
      }
    } catch (error) {
      this.setData({ message: '入口识别失败，请重新扫码' });
      wx.showToast({ title: error.message || '入口识别失败', icon: 'none' });
    } finally {
      this.routing = false;
      this.setData({ resolving: false });
    }
  },

  redirect(url) {
    wx.redirectTo({
      url,
      fail: () => {
        this.setData({ message: '页面打开失败，请重新扫码' });
        wx.showToast({ title: '页面打开失败，请重新扫码', icon: 'none' });
      }
    });
  },

  openTable(tableId) {
    const table = store.getTableById(tableId);
    if (!table) {
      this.setData({ message: '未识别到有效桌号，请扫一扫桌面上的二维码' });
      wx.showToast({ title: '桌号无效，请重新扫码', icon: 'none' });
      return;
    }
    getApp().globalData.selectedTableId = table.id;
    this.redirect(`/pages/menu/menu?tableId=${encodeURIComponent(table.id)}`);
  },

  scanTable() {
    if (this.data.scanning || this.data.resolving) {
      return;
    }
    this.setData({ scanning: true });
    wx.scanCode({
      onlyFromCamera: true,
      success: (result) => {
        try {
          const path = result.path || result.result || '';
          const queryStart = path.indexOf('?');
          const tableId = queryStart >= 0
            ? getEntryTableId({ scene: path.slice(queryStart + 1) })
            : getEntryTableId({ scene: path });
          this.openTable(tableId);
        } catch (error) {
          wx.showToast({ title: '二维码无效，请扫描桌面上的小程序码', icon: 'none' });
        }
      },
      fail: (error) => {
        if (!/cancel/i.test(error.errMsg || '')) {
          wx.showToast({ title: '无法扫码，请检查相机权限后重试', icon: 'none' });
        }
      },
      complete: () => this.setData({ scanning: false })
    });
  }
};
