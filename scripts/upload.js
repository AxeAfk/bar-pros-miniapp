const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const implPath = path.resolve(__dirname, 'upload-impl.js');
const currentMajor = Number(process.versions.node.split('.')[0]);
const preferredNodes = [
  process.env.MINIPROGRAM_NODE_PATH,
  path.join(process.env.HOME || '', '.nvm/versions/node/v24.12.0/bin/node'),
  '/usr/local/bin/node',
  process.execPath
].filter(Boolean);

function canUse(nodePath) {
  if (!fs.existsSync(nodePath)) {
    return false;
  }

  const versionCheck = spawnSync(nodePath, ['-e', 'process.stdout.write(process.versions.node)'], {
    encoding: 'utf8'
  });

  if (versionCheck.status !== 0) {
    return false;
  }

  const major = Number(String(versionCheck.stdout || '').trim().split('.')[0]);
  return major > 0 && major < 25;
}

function run(nodePath) {
  const result = spawnSync(nodePath, [implPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
  });
  process.exit(result.status || 0);
}

if (currentMajor < 25) {
  run(process.execPath);
}

const selectedNode = preferredNodes.find(canUse);

if (!selectedNode) {
  console.error('当前 Node 版本过高，miniprogram-ci 在 Node 25 下会报错。请安装 Node 24，或通过 MINIPROGRAM_NODE_PATH 指定可用的 Node 可执行文件。');
  process.exit(1);
}

run(selectedNode);
