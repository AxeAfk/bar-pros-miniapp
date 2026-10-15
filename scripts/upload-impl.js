const fs = require('fs');
const path = require('path');
const ci = require('miniprogram-ci');
const requestUtils = require('miniprogram-ci/dist/utils/request');
const packageJson = require('../package.json');

const appid = 'wx96b137579e055d85';
const projectPath = path.resolve(__dirname, '..');
const privateKeyPath = process.env.MINIPROGRAM_PRIVATE_KEY_PATH || '/Users/gh/Downloads/private.wx96b137579e055d85.key';
const version = process.env.MINIPROGRAM_VERSION || packageJson.version;
const desc = process.env.MINIPROGRAM_DESC || '个人号演示版：扫码点单，不含线上支付';
const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`私钥文件不存在: ${privateKeyPath}`);
  }

  process.env.NO_PROXY = [process.env.NO_PROXY, 'servicewechat.com'].filter(Boolean).join(',');
  process.env.no_proxy = [process.env.no_proxy, 'servicewechat.com'].filter(Boolean).join(',');
  requestUtils.setCiProxy(false);

  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath,
    privateKeyPath,
    ignores: ['node_modules/**/*', 'preview/**/*', 'scripts/**/*']
  });

  if (dryRun) {
    console.log('Upload config is ready.');
    console.log(JSON.stringify({
      appid,
      projectPath,
      privateKeyPath,
      version,
      desc,
      node: process.execPath,
      nodeVersion: process.versions.node
    }, null, 2));
    return;
  }

  const result = await ci.upload({
    project,
    version,
    desc,
    setting: {
      es6: true,
      minify: true,
      minified: true
    },
    onProgressUpdate(update) {
      if (update && update.message) {
        console.log(update.message);
      }
    }
  });

  console.log('Upload completed.');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error && error.message ? error.message : String(error || '');
  if (message.includes('invalid ip')) {
    console.error('微信后台拒绝了当前出口 IP。请先在微信公众平台的小程序 CI 配置里，把当前 IP 加入白名单后再重试。');
    console.error(message);
    process.exit(2);
  }

  console.error(message || error);
  process.exit(1);
});
