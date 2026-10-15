const { cloudEnvId } = require('./config/app');
const { getEntryTableId } = require('./utils/entry');

App({
  globalData: {
    selectedTableId: '',
    entryTableId: '',
    adminName: '管理员'
  },

  onLaunch(options) {
    if (wx.cloud && cloudEnvId) {
      wx.cloud.init({
        env: cloudEnvId,
        traceUser: true
      });
    }

    this.updateEntryTableId(options);
  },

  onShow(options) {
    this.updateEntryTableId(options);
  },

  updateEntryTableId(options) {
    const tableId = getEntryTableId(options && options.query ? options.query : options);
    if (tableId) {
      this.globalData.entryTableId = tableId;
      this.globalData.selectedTableId = tableId;
    }
  },

  consumeEntryTableId() {
    const tableId = this.globalData.entryTableId;
    this.globalData.entryTableId = '';
    return tableId;
  }
});
