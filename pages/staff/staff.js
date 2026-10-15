const store = require('../../services/store');

function attachInviteImage(invite) {
  if (!invite) return Promise.resolve(invite);
  if (invite.qrCodeUrl) {
    return Promise.resolve({ ...invite, qrCodeImage: invite.qrCodeUrl });
  }
  if (!invite.qrCodeDataUrl) {
    return Promise.resolve(invite);
  }
  if (!wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) {
    return Promise.resolve({ ...invite, qrCodeImage: invite.qrCodeDataUrl });
  }
  const filePath = `${wx.env.USER_DATA_PATH}/admin-invite-${invite.code}.png`;
  return new Promise((resolve) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: invite.qrCodeDataUrl.replace(/^data:image\/png;base64,/, ''),
      encoding: 'base64',
      success: () => resolve({ ...invite, qrCodeImage: filePath }),
      fail: () => resolve({ ...invite, qrCodeImage: invite.qrCodeDataUrl })
    });
  });
}

function inviteVersionHint(invite) {
  if (!invite || !invite.qrCodeEnvVersion || invite.qrCodeEnvVersion === 'release') {
    return '';
  }
  if (invite.qrCodeEnvVersion === 'trial') {
    return '当前生成的是体验版二维码，只有已加入体验成员的微信才能扫码打开。';
  }
  if (invite.qrCodeEnvVersion === 'develop') {
    return '当前生成的是开发版二维码，只有项目开发者微信才能扫码打开。';
  }
  return '';
}

Page({
  data: {
    adminProfile: { isAdmin: false, isOwner: false, ownerMaskedOpenid: '' },
    adminMembers: [],
    loadingAdminMembers: false,
    creatingInvite: false,
    removingMemberId: '',
    invite: null,
    employees: [],
    editor: null,
    saving: false,
    loadingEmployees: false
  },

  onShow() {
    return Promise.all([this.refreshAdminMembers(), this.refreshEmployees()]);
  },

  async refreshAdminMembers() {
    if (this.data.loadingAdminMembers) return;
    this.setData({ loadingAdminMembers: true });
    try {
      const [adminProfile, adminMembers] = await Promise.all([
        store.getAdminProfile(),
        store.listAdminMembers()
      ]);
      this.setData({ adminProfile, adminMembers });
    } catch (error) {
      wx.showToast({ title: error.message || '后台成员读取失败', icon: 'none' });
    } finally {
      this.setData({ loadingAdminMembers: false });
    }
  },

  async createInvite() {
    if (this.data.creatingInvite || !this.data.adminProfile.isOwner) return;
    this.setData({ creatingInvite: true });
    try {
      const invite = await attachInviteImage(await store.createAdminInvite());
      const versionHint = inviteVersionHint(invite);
      if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
        console.warn('[admin-invite] generated qr code', {
          code: invite.code,
          envVersion: invite.qrCodeEnvVersion || 'unknown',
          hasTempUrl: Boolean(invite.qrCodeUrl),
          hasInlineImage: Boolean(invite.qrCodeDataUrl),
          versionHint
        });
      }
      this.setData({ invite });
      wx.showToast({ title: '邀请码已生成', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '邀请码生成失败', icon: 'none' });
    } finally {
      this.setData({ creatingInvite: false });
    }
  },

  async removeAdminMember(event) {
    if (!this.data.adminProfile.isOwner || this.data.removingMemberId) return;
    const openid = event.currentTarget.dataset.id;
    const member = this.data.adminMembers.find((entry) => entry.openid === openid);
    if (!member || !member.removable) {
      wx.showToast({ title: '该成员不可移除', icon: 'none' });
      return;
    }
    this.setData({ removingMemberId: openid });
    try {
      const result = await new Promise((resolve, reject) => wx.showModal({
        title: '移除后台成员',
        content: `确认移除 ${member.maskedOpenid} 的后台权限吗？移除后对方将不能再进入后台。`,
        success: resolve,
        fail: reject
      }));
      if (!result.confirm) return;
      await store.removeAdminMember(openid);
      wx.showToast({ title: '成员已移除' });
      await this.refreshAdminMembers();
    } catch (error) {
      wx.showToast({ title: error.message || '成员移除失败', icon: 'none' });
    } finally {
      this.setData({ removingMemberId: '' });
    }
  },

  async refreshEmployees() {
    if (this.data.loadingEmployees) return;
    this.setData({ loadingEmployees: true });
    try {
      this.setData({ employees: await store.listEmployees() });
    } catch (error) {
      wx.showToast({ title: error.message || '游戏师列表读取失败', icon: 'none' });
    } finally {
      this.setData({ loadingEmployees: false });
    }
  },

  newEmployee() {
    if (!this.data.saving) this.setData({ editor: { name: '', active: true } });
  },

  editEmployee(event) {
    if (this.data.saving) return;
    const employee = this.data.employees.find((entry) => entry.id === event.currentTarget.dataset.id);
    if (!employee) {
      wx.showToast({ title: '游戏师已变化，请刷新列表', icon: 'none' });
      return;
    }
    this.setData({ editor: { id: employee.id, name: employee.name, active: employee.active } });
  },

  editName(event) {
    if (!this.data.saving) this.setData({ editor: { ...this.data.editor, name: event.detail.value } });
  },

  editActive(event) {
    if (!this.data.saving) this.setData({ editor: { ...this.data.editor, active: event.detail.value } });
  },

  cancelEdit() {
    if (!this.data.saving) this.setData({ editor: null });
  },

  async saveEmployee() {
    if (!this.data.editor || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await store.saveEmployee(this.data.editor);
      this.setData({ editor: null });
      wx.showToast({ title: '游戏师已保存' });
      await this.refreshEmployees();
    } catch (error) {
      wx.showToast({ title: error.message || '游戏师保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
