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
    return '';
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
    return normalizeTableId(values.table_id || values.tableId || values.tid) ||
      (values.scene ? parseScene(values.scene) : '');
  }

  return normalizeTableId(decoded);
}

function getEntryTableId(options) {
  if (!options) {
    return '';
  }

  return normalizeTableId(options.table_id || options.tableId || options.tid) || parseScene(options.scene);
}

module.exports = {
  getEntryTableId,
  normalizeTableId
};
