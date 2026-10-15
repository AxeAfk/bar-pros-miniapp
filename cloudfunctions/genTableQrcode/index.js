const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

function normalizeTableId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Table ID must be an integer from 1 to 6');
  }
  const text = String(value).trim();
  if (!/^(?:T0?|0)?[1-6]$/i.test(text)) {
    throw new Error('Table ID must be an integer from 1 to 6');
  }
  return Number(text.replace(/^T/i, ''));
}

function selectTables(event) {
  const modes = ['tableId', 'tableIds', 'range'].filter((key) => event[key] !== undefined);
  if (modes.length > 1) {
    throw new Error('Use only one of tableId, tableIds or range');
  }
  if (event.tableId !== undefined) {
    return [normalizeTableId(event.tableId)];
  }
  if (event.tableIds !== undefined) {
    if (!Array.isArray(event.tableIds) || !event.tableIds.length || event.tableIds.length > 100) {
      throw new Error('tableIds must contain 1 to 100 entries');
    }
    return [...new Set(event.tableIds.map(normalizeTableId))];
  }
  if (event.range !== undefined) {
    if (!event.range || typeof event.range !== 'object') {
      throw new Error('range must specify from and to');
    }
    const from = normalizeTableId(event.range.from);
    const to = normalizeTableId(event.range.to);
    if (from > to) {
      throw new Error('range.from must not exceed range.to');
    }
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }
  return [1, 2, 3, 4, 5, 6];
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const admins = String(process.env.ADMIN_OPENIDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!OPENID || !admins.includes(OPENID)) {
    throw new Error('Administrator authorization required');
  }
  const tableIds = selectTables(event);
  const envVersion = event.envVersion || 'release';
  if (!['release', 'trial', 'develop'].includes(envVersion)) {
    throw new Error('envVersion must be release, trial or develop');
  }
  const results = [];
  for (const tableId of tableIds) {
    const result = { tableId, success: false };
    try {
      const code = await cloud.openapi.wxacode.getUnlimited({
        page: 'pages/entry/entry',
        scene: `table_id=${tableId}`,
        envVersion,
        checkPath: envVersion === 'release',
        width: 430
      });
      if (!code || (code.errCode && code.errCode !== 0) ||
          !Buffer.isBuffer(code.buffer) || !code.buffer.length) {
        throw new Error(`WeChat code generation failed: ${code && code.errMsg ? code.errMsg : 'no image returned'}`);
      }
      const uploaded = await cloud.uploadFile({
        cloudPath: `qrcode/tables/${envVersion}/table_${tableId}.png`,
        fileContent: code.buffer
      });
      if (!uploaded || !uploaded.fileID) {
        throw new Error('Cloud upload did not return a fileID');
      }
      result.fileID = uploaded.fileID;
      const links = await cloud.getTempFileURL({ fileList: [uploaded.fileID] });
      const file = links && links.fileList && links.fileList[0];
      if (!file || file.status !== 0 || !file.tempFileURL) {
        throw new Error(`Download URL unavailable: ${file && file.errMsg ? file.errMsg : 'no URL returned'}`);
      }
      result.url = file.tempFileURL;
      result.success = true;
    } catch (error) {
      result.error = error.message;
      console.error('Table code generation failed', { tableId, envVersion, error });
    }
    results.push(result);
  }
  const successCount = results.filter((result) => result.success).length;
  return {
    success: successCount === results.length,
    envVersion,
    total: results.length,
    successCount,
    failCount: results.length - successCount,
    results,
    tempUrls: results.filter((result) => result.success).map((result) => result.url)
  };
};
