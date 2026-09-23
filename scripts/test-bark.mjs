const DEFAULT_SERVER_URL = 'https://api.day.app';
const DEFAULT_TITLE = 'Gate CrossEx 推送测试';
const DEFAULT_BODY = 'Bark 通道已连接，后续可以接入业务告警。';

function printUsage() {
  console.log(`用法：
  npm run test:bark -- [--dry-run] [--title <标题>] [--body <正文>]

环境变量：
  BARK_DEVICE_KEY   必填（--dry-run 时除外），Bark App 测试 URL 中的设备 Key
  BARK_SERVER_URL   可选，默认使用 https://api.day.app
  BARK_TEST_TITLE   可选，测试消息标题
  BARK_TEST_BODY    可选，测试消息正文

示例：
  npm run test:bark -- --dry-run
  npm run test:bark -- --title "测试标题" --body "测试正文"`);
}

function readOptionValue(argumentsList, index, option) {
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} 缺少参数值`);
  }
  return value;
}

function parseArguments(argumentsList) {
  const options = {
    dryRun: false,
    title: process.env.BARK_TEST_TITLE ?? DEFAULT_TITLE,
    body: process.env.BARK_TEST_BODY ?? DEFAULT_BODY,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--title' || argument === '--body') {
      options[argument.slice(2)] = readOptionValue(argumentsList, index, argument);
      index += 1;
      continue;
    }

    throw new Error(`不支持的参数：${argument}`);
  }

  return options;
}

function createEndpoint(serverUrl) {
  let endpoint;
  try {
    endpoint = new URL('/push', serverUrl);
  } catch {
    throw new Error(`BARK_SERVER_URL 不是有效 URL：${serverUrl}`);
  }

  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('BARK_SERVER_URL 只支持 http 或 https');
  }
  return endpoint;
}

async function sendTestMessage(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`Bark 返回了非 JSON 响应（HTTP ${response.status}）`);
  }

  if (!response.ok || result.code !== 200) {
    throw new Error(`Bark 拒绝了请求（HTTP ${response.status}，code=${String(result.code)}）：${result.message ?? '未知错误'}`);
  }

  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const deviceKey = process.env.BARK_DEVICE_KEY?.trim();
  if (!options.dryRun && !deviceKey) {
    throw new Error('缺少 BARK_DEVICE_KEY。请先按 docs/bark-notification.md 配置设备 Key，或使用 --dry-run。');
  }

  const endpoint = createEndpoint(process.env.BARK_SERVER_URL?.trim() || DEFAULT_SERVER_URL);
  const payload = {
    device_key: deviceKey ?? '<未配置，仅预览>',
    title: options.title,
    body: options.body,
    group: 'gate-crossex',
  };

  if (options.dryRun) {
    console.log('Bark 测试请求预览（未发送）：');
    console.log(JSON.stringify({ endpoint: endpoint.href, payload: { ...payload, device_key: '<已隐藏>' } }, null, 2));
    return;
  }

  await sendTestMessage(endpoint, payload);
  console.log('Bark 已受理测试消息，请在 iPhone 上确认是否收到通知。');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Bark 测试失败：${message}`);
  process.exitCode = 1;
});
