# Gate CrossEx 服务器部署与访问

本文记录当前 Google Cloud 单机部署、日常更新以及 Mac/手机访问方式。服务包含真实交易能力，因此默认不开放公网 HTTP、HTTPS 或交易端口。

## 当前实例

```text
Google Cloud project: project-d47dd35b-3573-43da-bf2
Instance:             instance-20260809-014606
Zone:                 asia-east2-a
Hostname:             wangzilong13991-hk2-gctx-prod.internal
Operating system:     Ubuntu 24.04.4 LTS x86_64
Machine:              e2-highmem-2 (2 vCPU, 16 GB RAM)
Source:               /home/wangzilong/gate-crossex
Service:              gate-crossex.service
Private listen:       127.0.0.1:17840
Tailnet HTTPS:        https://wangzilong13991-hk2-gctx-prod.tailbbc617.ts.net
```

源代码从 `https://github.com/ifreeWorld/gate-crossex.git` 的 `main` 分支拉取。Node.js 使用项目目录内经过官方 SHA-256 校验的独立运行时：

```text
/home/wangzilong/gate-crossex/.runtime
```

## 从 Mac 管理服务器

仓库根目录已有连接脚本：

```bash
cd /Users/wangzilong/mycode/gate-crossex
bash gcloud.sh
```

脚本会选择正确的 Google 账号、项目、实例和区域。如果 Google 登录过期：

```bash
gcloud auth login wangzilong13991@gmail.com
```

查看实例：

```bash
gcloud compute instances list
```

## systemd 服务管理

查看状态：

```bash
sudo systemctl status gate-crossex --no-pager
```

查看实时日志：

```bash
sudo journalctl -u gate-crossex -f
```

启动、停止和重启：

```bash
sudo systemctl start gate-crossex
sudo systemctl stop gate-crossex
sudo systemctl restart gate-crossex
```

检查健康状态：

```bash
curl -fsS http://127.0.0.1:17840/health
```

服务已启用开机启动：

```bash
sudo systemctl is-enabled gate-crossex
```

systemd 直接运行编译后的 Fastify 后端，不需要 PM2 或 Docker。后端收到 `SIGTERM` 时会执行策略和订单的安全停机流程。

## 从 Mac 访问页面

在本地仓库运行 SSH 隧道：

```bash
bash gcloud.sh tunnel
```

保持终端窗口开启，在 Mac 浏览器访问：

```text
http://127.0.0.1:27840
```

该命令把 Mac 的 `27840` 转发到服务器的 `127.0.0.1:17840`，不需要开放 GCP HTTP/HTTPS 防火墙。Mac 的 `17840` 始终留给本地开发服务使用。

## 从手机访问页面

手机通过 Tailscale 私网访问，不使用公网反向代理，也不使用 Tailscale Funnel。

服务器完成 Tailscale 登录后运行：

```bash
sudo tailscale serve --bg 17840
sudo tailscale serve status
```

`serve status` 会显示仅在 Tailnet 内可访问的 HTTPS 地址。将该地址的主机名（不包含 `https://`）加入 systemd 的 `GCT_ALLOWED_HOSTS`，然后重启服务。仓库中的 unit 文件会在首次部署时写入实际值；如果 Tailnet 域名以后发生变化，也必须同步更新该白名单。

当前地址是：

```text
https://wangzilong13991-hk2-gctx-prod.tailbbc617.ts.net
```

### 首次配置 Shadowrocket

Shadowrocket App Store 版从 2.2.90 开始提供 Tailscale 全局隧道、本地 MagicDNS 和 Peer 管理界面。不同界面语言的名称可能略有不同，配置路径通常是 `设置 > Tailscale`。

先创建只使用一次的手机注册密钥：

1. 在 Safari 打开 [Tailscale Machines 页面](https://login.tailscale.com/admin/machines)并登录。
2. 确认设备列表里已经存在服务器 `wangzilong13991-hk2-gctx-prod`。能看到它，就说明当前登录的是正确 Tailnet。
3. 打开 [Tailscale Keys 管理页](https://login.tailscale.com/admin/settings/keys)，选择生成 Auth Key。
4. 创建密钥时建议这样设置：

   - `Reusable/可重复使用`：关闭。密钥只允许注册一个设备。
   - `Ephemeral/临时设备`：关闭。手机重启或暂时离线后不会被自动移出 Tailnet。
   - `Pre-approved/预授权`：打开。如果没有该选项，手机注册后再到 Machines 页面手工批准。
   - `Tags`：留空。手机作为当前用户的个人设备加入即可。
   - `Expiration`：选择较短时间，例如 1 天；它只限制密钥还能被使用多久。

5. 复制以 `tskey-auth-` 开头的密钥。不要把它写进仓库、备忘录同步、截图或聊天。

再配置 Shadowrocket：

1. 从 App Store 将 Shadowrocket 更新到 2.2.90 或更高版本。
2. 打开 `Shadowrocket > 设置 > Tailscale`。
3. 在“认证密钥/Auth Key”中粘贴刚生成的 `tskey-auth-...`。
4. “控制服务器 URL/Control Server URL”保持默认或留空。本项目使用官方 Tailscale，不使用 Headscale。
5. “出口节点/Exit Node”保持未选择；“始终使用 DERP”保持关闭。只有网络无法建立直连时，Tailscale 才会自动使用中继。
6. 打开“启用”。这里表示处理 Tailnet 流量，并不表示把手机的全部互联网流量转发到这台服务器。
7. 返回 Shadowrocket 主页面并打开顶部总开关。iOS 第一次会要求添加 VPN 配置，选择“允许”并通过 Face ID、Touch ID 或锁屏密码确认。
8. 再进入 `设置 > Tailscale`，确认 Peer/设备列表中能看到以下服务器且状态为在线：

   ```text
   wangzilong13991-hk2-gctx-prod
   ```

9. 如果 Tailnet 开启了设备审批，到 Machines 页面批准刚出现的 iPhone/Shadowrocket 设备。
10. 一次性 Auth Key 使用后会失效；仍可回到 Keys 页面确认并撤销它。撤销注册密钥不会删除已经注册好的手机，删除手机要在 Machines 页面操作。
11. 打开 Safari，访问：

   ```text
   https://wangzilong13991-hk2-gctx-prod.tailbbc617.ts.net
   ```

不要在地址后添加 `:17840`，也不要使用服务器公网 IP `34.92.73.137`。Tailscale Serve 已经负责私网 HTTPS 和到本机 `17840` 端口的转发。

### 每次使用时

后续通常不需要重新登录：

1. 打开 Shadowrocket 总开关，并确认 Tailscale 模块处于已连接状态。
2. 用 Safari 打开上面的固定 HTTPS 地址。
3. 使用完成后可以关闭 Shadowrocket；关闭后该私网页面将无法访问。

不需要选择 Exit Node（出口节点），也不要把这台交易服务器配置成出口节点。本配置只让手机访问 Tailnet 内的 Gate CrossEx，不依赖公网开放网站端口。

### 与 Shadowrocket 原有代理订阅共存

如果 Shadowrocket 还承担日常代理功能，应使用它内置的 Tailscale 模块，让 Tailnet 流量走 Tailscale、普通互联网流量继续按原有规则处理：

- 在当前 Shadowrocket 配置文件的规则中，确保 Tailnet 域名交给内置的 `TAILSCALE` 策略：

  ```text
  DOMAIN-SUFFIX,ts.net,TAILSCALE
  ```

- 如果还会直接使用设备的 `100.x.y.z` Tailscale IP，可再添加：

  ```text
  IP-CIDR,100.64.0.0/10,TAILSCALE,no-resolve
  ```

- 把上述规则放在会匹配 `ts.net` 或 `100.64.0.0/10` 的普通 `PROXY`、`DIRECT`、`FINAL` 规则之前。
- 检查 `设置 > 排除路由` 或配置文件中的 `tun-excluded-routes`，不要排除 `100.64.0.0/10`，否则 Tailscale 流量可能进不了隧道。
- Shadowrocket 2.2.90 的 Tailscale 模块包含本地 MagicDNS；保持 Tailscale 功能启用即可。
- 不要为了访问本项目添加公网 `HTTP/HTTPS` 防火墙规则。
- 不要简单给 `*.ts.net` 添加普通 `DIRECT` 规则后关闭 Tailscale；`DIRECT` 本身无法访问 Tailnet 私网。

Shadowrocket 各版本的规则页名称可能不同。优先使用它的内置 Tailscale 路由，不需要手工建立一个指向 `34.92.73.137` 的代理节点。

### 验证连接

先在 Safari 打开健康检查地址：

```text
https://wangzilong13991-hk2-gctx-prod.tailbbc617.ts.net/health
```

正常时会看到包含以下字段的 JSON：

```json
{"ok":true,"database":"ok"}
```

然后去掉 `/health` 打开主页面。如果健康检查成功而主页面异常，说明手机到服务器的私网链路正常，应检查前端构建或后端日志。

### 常见问题

**Shadowrocket 中没有 Tailscale 入口**

先更新 Shadowrocket。如果最新版仍没有该功能，安装官方 [Tailscale iOS App](https://apps.apple.com/app/tailscale/id1470499037)，登录同一账户后访问上述地址。iOS 通常只允许一个主要 VPN 隧道同时接管网络，测试官方 Tailscale App 时先关闭 Shadowrocket 的 VPN 开关。

**Safari 提示找不到服务器或无法解析域名**

确认 Shadowrocket 总开关、Tailscale 模块和 MagicDNS 均已开启，并确认 Peer 列表中的服务器在线。可以在 Wi-Fi 和蜂窝网络之间切换一次后重试。

**登录了 Tailscale 但看不到服务器**

通常是登录到了另一个 Tailscale 账户或 Tailnet。到 [Tailscale Machines 页面](https://login.tailscale.com/admin/machines)确认手机和 `wangzilong13991-hk2-gctx-prod` 出现在同一设备列表中。

**页面返回 `403` 或 `non_local_host_rejected`**

Tailnet 已连通，但后端主机名白名单不匹配。登录服务器检查 systemd 中的 `GCT_ALLOWED_HOSTS` 是否包含当前 `*.ts.net` 主机名，然后重启 `gate-crossex`。

**页面显示 `502 Bad Gateway` 或连接被拒绝**

从 Mac 登录服务器并检查：

```bash
sudo systemctl status gate-crossex --no-pager
sudo tailscale serve status
curl -fsS http://127.0.0.1:17840/health
```

**Shadowrocket 普通代理正常，但本项目打不开**

检查 `*.ts.net` 或 `100.64.0.0/10` 是否被错误发送到普通代理节点。它们应交给 Shadowrocket 的 Tailscale 模块。也可以临时关闭普通代理规则，仅保留 Tailscale 模块来定位问题。

### 手机丢失或取消访问权限

立即进入 [Tailscale Machines 页面](https://login.tailscale.com/admin/machines)，找到丢失的手机并移除或禁用。设备被移出 Tailnet 后，即使知道页面地址也无法再访问服务器。如果使用过认证密钥，同时在 Keys 页面撤销该密钥。

## 更新 main 并重新部署

更新期间先停止服务，避免运行中的进程读取一半新、一半旧的构建产物：

```bash
cd /home/wangzilong/gate-crossex
sudo systemctl stop gate-crossex
git fetch origin main
git checkout main
git pull --ff-only origin main
PATH="$PWD/.runtime/bin:$PATH" npm ci --no-audit --no-fund
PATH="$PWD/.runtime/bin:$PATH" npm run build
sudo systemctl start gate-crossex
curl -fsS http://127.0.0.1:17840/health
```

如果任一步骤失败，不要启动实盘服务；先检查：

```bash
git status --short
sudo journalctl -u gate-crossex -n 200 --no-pager
```

## 凭据和数据

服务器没有桌面系统钥匙串，因此 systemd 明确使用本地凭据文件：

```text
/home/wangzilong/gate-crossex/.local-data/credentials.env
```

该文件必须保持 `0600` 权限。不要把它、SQLite 数据库或未脱敏日志加入 Git、上传网盘或发到聊天中。

数据库位置：

```text
/home/wangzilong/gate-crossex/.local-data/gate-crossex.sqlite
```

备份前应先停止服务，再使用仓库提供的备份脚本。不要直接复制正在 WAL 模式运行的 SQLite 主文件。

## 网络安全边界

- Gate CrossEx 只监听 `127.0.0.1:17840`。
- GCP 不开放公网 HTTP、HTTPS、17840 或 IB Gateway API 端口。
- Mac 使用 SSH/IAP 隧道。
- 手机使用 Tailscale Serve 私网 HTTPS。
- 不运行 `tailscale funnel`。
- IB Gateway/TWS API 端口仅允许服务器本机访问。
- 每次后端重启都会回到交易锁定状态，需要用户重新确认才能进入实盘模式。
