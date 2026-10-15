function normalizeTableId(value) {
  return decodeURIComponent(String(value || '').trim()).toUpperCase();
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
      const [key, value] = part.split('=');
      if (key) {
        values[key] = value;
      }
    });
    return normalizeTableId(values.tableId || values.tid);
  }

  return normalizeTableId(decoded);
}

function getEntryTableId(options) {
  if (!options) {
    return '';
  }

  return normalizeTableId(options.tableId || options.tid) || parseScene(options.scene);
}

module.exports = {
  getEntryTableId,
  normalizeTableId
};
