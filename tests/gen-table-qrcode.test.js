const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFunction(options = {}) {
  const calls = [];
  const cloud = {
    init() {},
    getWXContext: () => ({ OPENID: options.openid || 'admin' }),
    openapi: {
      wxacode: {
        async getUnlimited(request) {
          calls.push(request);
          if (request.scene === `table_id=${options.failTable}`) {
            throw new Error('WeChat API unavailable');
          }
          return { buffer: Buffer.from('test-image') };
        }
      }
    },
    async uploadFile(request) {
      return { fileID: `cloud://${request.cloudPath}` };
    },
    async getTempFileURL({ fileList }) {
      return {
        fileList: [{
          status: options.failUrl ? -1 : 0,
          tempFileURL: options.failUrl ? '' : `https://example.invalid/${fileList[0]}`
        }]
      };
    }
  };
  const context = {
    exports: {},
    require: (name) => {
      assert.equal(name, 'wx-server-sdk');
      return cloud;
    },
    process: { env: { ADMIN_OPENIDS: 'admin' } },
    console: { error() {} },
    Buffer
  };
  const file = path.join(__dirname, '..', 'cloudfunctions', 'genTableQrcode', 'index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return { main: context.exports.main, calls };
}

test('generates all six table codes with correct scene and separate trial paths', async () => {
  const { main, calls } = loadFunction();
  const result = await main({ envVersion: 'trial' });
  assert.equal(result.success, true);
  assert.equal(result.successCount, 6);
  assert.equal(result.failCount, 0);
  for (let index = 0; index < 6; index += 1) {
    assert.equal(calls[index].scene, `table_id=${index + 1}`);
    assert.equal(calls[index].page, 'pages/entry/entry');
    assert.equal(calls[index].envVersion, 'trial');
    assert.equal(calls[index].checkPath, false);
    assert.equal(result.results[index].fileID, `cloud://qrcode/tables/trial/table_${index + 1}.png`);
    assert.ok(result.results[index].url);
  }
});

test('defaults to release and deduplicates supported table aliases', async () => {
  const { main, calls } = loadFunction();
  const result = await main({ tableIds: [1, '01', 'T01', 6] });
  assert.equal(result.total, 2);
  assert.equal(calls[0].envVersion, 'release');
  assert.equal(calls[0].checkPath, true);
});

test('rejects unauthorized calls before generating any images', async () => {
  const { main, calls } = loadFunction({ openid: 'customer' });
  await assert.rejects(main(), /authorization/);
  assert.equal(calls.length, 0);
});

test('rejects invalid tables, ranges, versions and conflicting selectors', async () => {
  const { main, calls } = loadFunction();
  for (const input of [
    { tableId: 7 }, { tableId: 0 }, { tableId: 1.5 }, { tableId: null },
    { tableIds: [] }, { range: { from: 6, to: 1 } },
    { tableId: 1, tableIds: [1] }, { envVersion: 'other' }
  ]) {
    await assert.rejects(main(input));
  }
  assert.equal(calls.length, 0);
});

test('reports partial failure and continues the batch', async () => {
  const { main } = loadFunction({ failTable: 2 });
  const result = await main({ range: { from: 1, to: 3 } });
  assert.equal(result.success, false);
  assert.equal(result.successCount, 2);
  assert.equal(result.failCount, 1);
  assert.match(result.results[1].error, /WeChat API unavailable/);
  assert.equal(result.results[2].success, true);
  assert.equal(result.tempUrls.length, 2);
});

test('retains uploaded fileID when temporary URL lookup fails', async () => {
  const { main } = loadFunction({ failUrl: true });
  const result = await main({ tableId: 1 });
  assert.equal(result.success, false);
  assert.ok(result.results[0].fileID);
  assert.match(result.results[0].error, /Download URL unavailable/);
});
