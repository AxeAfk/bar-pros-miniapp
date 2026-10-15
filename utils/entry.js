function normalizeTableId(value) {
  const tableId = decodeURIComponent(String(value || '').trim()).toUpperCase();
  if (/^\d{1,2}$/.test(tableId)) {
    return `T${tableId.padStart(2, '0')}`;
  }
  return tableId;
}

function parseScene(scene) {
  const decoded = decodeURIComponent(String(scene || '').trim());
  if (!decoded) {
    return {};
  }

  if (decoded.includes('=')) {
    const parts = decoded.split('&');
    const values = {};
    parts.forEach((part) => {
      const separator = part.indexOf('=');
      const key = separator < 0 ? part : part.slice(0, separator);
      const value = separator < 0 ? '' : part.slice(separator + 1);
      if (key) {
        values[key] = value;
      }
    });
    const nested = values.scene ? parseScene(values.scene) : {};
    return {
      tableId: normalizeTableId(values.table_id || values.tableId || values.tid) || nested.tableId || '',
      adminInvite: String(values.admin_invite || values.adminInvite || nested.adminInvite || '').trim()
    };
  }

  return { tableId: normalizeTableId(decoded), adminInvite: '' };
}

function getEntryTableId(options) {
  if (!options) return '';
  return getEntryParams(options).tableId;
}

function getAdminInviteCode(options) {
  if (!options) return '';
  return getEntryParams(options).adminInvite;
}

function getEntryParams(options) {
  if (!options) {
    return { tableId: '', adminInvite: '' };
  }
  const scene = parseScene(options.scene);
  return {
    tableId: normalizeTableId(options.table_id || options.tableId || options.tid) || scene.tableId || '',
    adminInvite: String(options.admin_invite || options.adminInvite || scene.adminInvite || '').trim()
  };
}

module.exports = {
  getEntryTableId,
  getAdminInviteCode,
  getEntryParams,
  normalizeTableId
};
