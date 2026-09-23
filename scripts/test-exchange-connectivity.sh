#!/usr/bin/env bash
# 独立脚本：仅依赖 Bash 和 Python 3 标准库，可单独复制到 Linux/macOS 运行。
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  echo '错误：需要 Python 3，无需 Node.js、npm 或 pip 包。' >&2
  exit 2
fi
exec python3 - "$@" <<'PY'
import argparse
import base64
import hashlib
import http.client
import json
import multiprocessing
import os
import socket
import ssl
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from datetime import datetime, timezone

LIMIT = 2_000_000
VENUES = {
    'gate': ('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT', 'wss://api.gateio.ws/ws/v4/'),
    'hyperliquid': ('https://api.hyperliquid.xyz/info', 'wss://api.hyperliquid.xyz/ws'),
    'binance': ('https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT', 'wss://stream.binance.com:9443/ws/btcusdt@bookTicker'),
    'okx': ('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT', 'wss://ws.okx.com:8443/ws/v5/public'),
    'bybit': ('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', 'wss://stream.bybit.com/v5/public/spot'),
}


def subscription(name):
    return {
        'gate': {'time': int(time.time()), 'channel': 'spot.tickers', 'event': 'subscribe', 'payload': ['BTC_USDT']},
        'hyperliquid': {'method': 'subscribe', 'subscription': {'type': 'allMids'}},
        'binance': None,
        'okx': {'op': 'subscribe', 'args': [{'channel': 'tickers', 'instId': 'BTC-USDT'}]},
        'bybit': {'op': 'subscribe', 'args': ['orderbook.1.BTCUSDT']},
    }[name]


def valid(name, protocol, data):
    try:
        if protocol == 'REST':
            if name == 'gate':
                return any(t['currency_pair'] == 'BTC_USDT' and float(t['last']) > 0 for t in data)
            if name == 'hyperliquid':
                return float(data['BTC']) > 0
            if name == 'binance':
                return data['symbol'] == 'BTCUSDT' and float(data['bidPrice']) > 0
            if name == 'okx':
                return data['code'] == '0' and data['data'][0]['instId'] == 'BTC-USDT' and float(data['data'][0]['last']) > 0
            return data['retCode'] == 0 and data['result']['list'][0]['symbol'] == 'BTCUSDT' and float(data['result']['list'][0]['lastPrice']) > 0
        if name == 'gate':
            return data['channel'] == 'spot.tickers' and data['event'] == 'update' and data['result']['currency_pair'] == 'BTC_USDT' and float(data['result']['last']) > 0
        if name == 'hyperliquid':
            return data['channel'] == 'allMids' and float(data['data']['mids']['BTC']) > 0
        if name == 'binance':
            return data['s'] == 'BTCUSDT' and float(data['b']) > 0 and float(data['a']) > 0
        if name == 'okx':
            return data['arg']['channel'] == 'tickers' and data['data'][0]['instId'] == 'BTC-USDT' and float(data['data'][0]['last']) > 0
        return data['topic'] == 'orderbook.1.BTCUSDT' and data['data']['s'] == 'BTCUSDT' and float(data['data']['b'][0][0]) > 0
    except (KeyError, IndexError, TypeError, ValueError):
        return False


def elapsed(start):
    return round((time.monotonic() - start) * 1000, 1)


def tls_context():
    context = ssl.create_default_context()
    # 补充系统 CA，仍严格校验 TLS；显式配置时尊重调用者的信任设置。
    if not os.environ.get('SSL_CERT_FILE') and not os.environ.get('SSL_CERT_DIR'):
        for path in ('/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt'):
            if os.path.isfile(path):
                context.load_verify_locations(cafile=path)
    return context


def rest(name, timeout, result):
    body = json.dumps({'type': 'allMids'}).encode() if name == 'hyperliquid' else None
    # 明确标识本工具；Python 默认 User-Agent 会触发 OKX 的 Cloudflare 1010。
    request = urllib.request.Request(result['url'], data=body, headers={'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'gate-crossex-connectivity/1.0'})
    # 与 WS 保持一致：不读取 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY。
    class Connection(http.client.HTTPSConnection):
        def connect(self):
            super().connect()
            result['remoteAddress'] = self.sock.getpeername()[0]

    class Handler(urllib.request.HTTPSHandler):
        def https_open(self, request):
            return self.do_open(Connection, request, context=tls_context())

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), Handler())
    try:
        with opener.open(request, timeout=timeout) as response:
            result['httpStatus'] = response.status
            raw = response.read(LIMIT + 1)
            if len(raw) > LIMIT:
                raise ValueError('响应超过 2 MB')
            if not valid(name, 'REST', json.loads(raw)):
                raise ValueError('接口未返回预期 BTC 行情')
    except urllib.error.HTTPError as error:
        result['httpStatus'] = error.code
        snippet = error.read(400).decode(errors='replace')
        raise ValueError('HTTP {}: {}'.format(error.code, ' '.join(snippet.split())[:200])) from error


def websocket(name, timeout, result, start, pipe):
    url = urllib.parse.urlsplit(result['url'])
    deadline = start + timeout
    def remaining():
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError('等待真实行情超时')
        return seconds
    with socket.create_connection((url.hostname, url.port or 443), timeout=remaining()) as tcp:
        with tls_context().wrap_socket(tcp, server_hostname=url.hostname) as stream:
            result['remoteAddress'] = stream.getpeername()[0]
            def read(size):
                data = bytearray()
                while len(data) < size:
                    stream.settimeout(remaining())
                    chunk = stream.recv(size - len(data))
                    if not chunk:
                        raise ConnectionError('收到行情前连接关闭')
                    data.extend(chunk)
                return bytes(data)
            def send(opcode, payload):
                mask = os.urandom(4)
                length = len(payload)
                header = bytes([0x80 | opcode])
                if length < 126:
                    header += bytes([0x80 | length])
                elif length < 65536:
                    header += bytes([0x80 | 126]) + struct.pack('!H', length)
                else:
                    header += bytes([0x80 | 127]) + struct.pack('!Q', length)
                stream.settimeout(remaining())
                stream.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
            key = base64.b64encode(os.urandom(16)).decode()
            path = url.path or '/'
            if url.query:
                path += '?' + url.query
            request = ('GET {} HTTP/1.1\r\nHost: {}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n').format(path, url.netloc, key)
            stream.sendall(request.encode())
            header = bytearray()
            while not header.endswith(b'\r\n\r\n'):
                header.extend(read(1))
                if len(header) > 32768:
                    raise ValueError('WS 握手响应头过大')
            lines = header.decode('iso-8859-1').split('\r\n')
            result['httpStatus'] = int(lines[0].split()[1])
            if result['httpStatus'] != 101:
                raise ValueError('WS 握手 HTTP {}'.format(result['httpStatus']))
            headers = dict(line.lower().split(':', 1) for line in lines[1:] if ':' in line)
            # Accept 的值区分大小写，使用原始头重新读取。
            accept = next((line.split(':', 1)[1].strip() for line in lines[1:] if line.lower().startswith('sec-websocket-accept:')), '')
            expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            if accept != expected or headers.get('upgrade', '').strip() != 'websocket' or 'upgrade' not in headers.get('connection', ''):
                raise ValueError('WS 握手校验失败')
            result['handshakeMs'] = elapsed(start)
            pipe.send(dict(result))
            message = subscription(name)
            if message:
                send(1, json.dumps(message).encode())
            fragments = bytearray()
            fragmented = False
            while True:
                first, second = read(2)
                final, opcode = bool(first & 0x80), first & 0x0f
                if first & 0x70 or second & 0x80:
                    raise ValueError('WS 帧使用未协商扩展或服务端掩码')
                length = second & 0x7f
                if length == 126:
                    length = struct.unpack('!H', read(2))[0]
                elif length == 127:
                    length = struct.unpack('!Q', read(8))[0]
                if length > LIMIT or (opcode < 8 and len(fragments) + length > LIMIT):
                    raise ValueError('WS 消息超过 2 MB')
                if opcode >= 8 and (not final or length > 125):
                    raise ValueError('无效 WS 控制帧')
                payload = read(length)
                if opcode == 8:
                    code = struct.unpack('!H', payload[:2])[0] if len(payload) >= 2 else 1005
                    raise ConnectionError('收到行情前 WS 关闭：{}'.format(code))
                if opcode == 9:
                    send(10, payload)
                    continue
                if opcode == 10:
                    continue
                if opcode == 1 and not fragmented:
                    fragments = bytearray(payload)
                elif opcode == 0 and fragmented:
                    fragments.extend(payload)
                else:
                    raise ValueError('非预期 WS 数据帧：{}'.format(opcode))
                fragmented = not final
                if fragmented:
                    continue
                data = json.loads(fragments.decode())
                fragments.clear()
                if isinstance(data, dict) and (data.get('error') or data.get('event') == 'error' or data.get('channel') == 'error' or data.get('success') is False):
                    raise ValueError('订阅失败：' + json.dumps(data, ensure_ascii=False)[:300])
                if valid(name, 'WS', data):
                    result['firstDataMs'] = elapsed(start)
                    return


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def initial_result(name, protocol):
    result = {'exchange': name, 'protocol': protocol, 'url': VENUES[name][protocol == 'WS'], 'ok': False}
    if protocol == 'WS':
        result.update(handshakeMs=None, firstDataMs=None)
    return result


def print_table(results):
    # 模拟 console.table：中文列名、边框、索引、字符串引号和空值占位符。
    headers = ['(index)', '交易所', '协议', '结果', '总耗时(ms)', 'WS握手(ms)', 'WS首条行情(ms)', 'HTTP', '原因']

    def cell(value):
        if value is None:
            value = '-'
        if isinstance(value, str):
            # 防止远端错误中的换行、制表符或终端控制字符破坏表格。
            value = ''.join(c if not unicodedata.category(c).startswith('C') else ascii(c)[1:-1] for c in value)
            return repr(value)
        return format(value, 'g')

    def width(value):
        return sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in ('W', 'F') else 1 for c in value)

    rows = [[str(index), cell(r['exchange']), cell(r['protocol']), cell('通过' if r['ok'] else '失败'),
             cell(r['elapsedMs']), cell(r.get('handshakeMs')), cell(r.get('firstDataMs')),
             cell(r.get('httpStatus')), cell(r.get('error', ''))] for index, r in enumerate(results)]
    widths = [max(width(row[i]) for row in [headers] + rows) for i in range(len(headers))]

    def border(left, middle, right):
        print(left + middle.join('─' * (w + 2) for w in widths) + right)

    def row(values):
        print('│ ' + ' │ '.join(value + ' ' * (w - width(value)) for value, w in zip(values, widths)) + ' │')

    border('┌', '┬', '┐')
    row(headers)
    border('├', '┼', '┤')
    for values in rows:
        row(values)
    border('└', '┴', '┘')


def worker(name, protocol, timeout, pipe):
    start = time.monotonic()
    result = initial_result(name, protocol)
    try:
        if protocol == 'REST':
            rest(name, timeout, result)
        else:
            websocket(name, timeout, result, start, pipe)
        result['ok'] = True
    except Exception as error:
        result['error'] = str(error)
    result['elapsedMs'] = elapsed(start)
    result['finished'] = True
    pipe.send(result)
    pipe.close()


def main():
    parser = argparse.ArgumentParser(description='独立公共接口测试；仅需 Python 3 标准库。测试 BTC 现货及 Hyperliquid 永续，WS 收到真实行情才算通过。', epilog='直连，不读取代理环境变量；系统 VPN/TUN 仍可影响路由。耗时包含 DNS/TCP/TLS，不代表撮合延迟。退出码：0 全通过，1 探测失败，2 参数错误。')
    parser.add_argument('--exchanges', default=','.join(VENUES), help='逗号分隔：gate,hype,binance,okx,bybit（默认全部）')
    parser.add_argument('--timeout', type=int, default=10000, help='每项总超时，毫秒，100–60000（默认 10000）')
    parser.add_argument('--json', action='store_true', help='仅输出 JSON')
    args = parser.parse_args()
    if not 100 <= args.timeout <= 60000:
        parser.error('--timeout 必须为 100–60000')
    names = list(dict.fromkeys('hyperliquid' if n.strip().lower() == 'hype' else n.strip().lower() for n in args.exchanges.split(',')))
    if any(n not in VENUES for n in names):
        parser.error('不支持的交易所；可选：' + ','.join(VENUES))
    started_at = timestamp()
    if not args.json:
        print('测试 {}，每项超时 {} ms，直连公共接口…'.format(', '.join(names), args.timeout), flush=True)
    # 独立进程提供硬超时，覆盖系统 DNS 阻塞及缓慢分块响应。
    context = multiprocessing.get_context('fork')
    jobs = []
    results = []
    try:
        for name in names:
            for protocol in ('REST', 'WS'):
                receiver, sender = context.Pipe(duplex=False)
                process = context.Process(target=worker, args=(name, protocol, args.timeout / 1000, sender))
                begin = time.monotonic()
                process.start()
                sender.close()
                jobs.append((process, receiver, begin, name, protocol))
        for process, receiver, begin, name, protocol in jobs:
            result = initial_result(name, protocol)
            while True:
                if not receiver.poll(max(0, begin + args.timeout / 1000 - time.monotonic())):
                    break
                try:
                    result = receiver.recv()
                except EOFError:
                    break
                if result.get('finished'):
                    break
            if not result.pop('finished', False):
                result.update(ok=False, elapsedMs=elapsed(begin), error='总超时或探测进程提前退出' + ('（WS 已握手，未收到有效行情）' if result.get('handshakeMs') is not None else ''))
            results.append(result)
    finally:
        for process, receiver, _, _, _ in jobs:
            if process.is_alive():
                process.terminate()
            process.join()
            receiver.close()
    passed = sum(r['ok'] for r in results)
    report = {'startedAt': started_at, 'finishedAt': timestamp(), 'timeoutMs': args.timeout, 'networkMode': 'direct', 'passed': passed, 'total': len(results), 'results': results}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_table(results)
        print('通过 {}/{}。使用 --json 可查看具体地址和结构化结果。'.format(passed, len(results)))
    return 0 if passed == len(results) else 1


try:
    sys.exit(main())
except KeyboardInterrupt:
    sys.exit(130)
PY
