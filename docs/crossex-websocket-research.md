# CrossEx WebSocket 限制与精选标的接入调研

调研日期：2026-09-20。本文区分官方说明、本次轻量验证、项目历史记录和设计建议。未修改业务代码。

## 结论

缩小到市值前 N 个标的，可以减少订阅量和计算量，让统一 CrossEx 接入更可行；但不能消除浅盘口、增量初始化、数量单位及行情时效的问题。建议先做精选标的的买一卖一看盘，容量只使用已验证的完整盘口；需要 Bybit 深度和 Kraken 容量时，暂保留原生来源。

仅靠 CrossEx WebSocket 还无法完全替代现有资金费率/持仓量体系：资金费率周期需要补充来源，Binance 持仓量频道也存在缺口。

## 官方接口边界

| 项目 | 核实结果 | 来源 |
| --- | --- | --- |
| 连接额度 | 写明每 `uid+channel` 最多 20 条；匿名公共入口如何按 IP 计数未明确 | [连接说明](https://www.gate.com/docs/developers/crossex/ws/en/#server-url) |
| 心跳 | 协议 Ping，30 秒内保持心跳；不应只发 JSON ping | 同上 |
| 订阅 | 支持追加、取消指定 symbols；不支持市场频道全量通配订阅 | [盘口订阅](https://www.gate.com/docs/developers/crossex/ws/en/#full-limited-level-order-book-subscription) |
| 订阅条数/发送频率 | 本次查阅的公共频道说明未给明确数字；下单限频不能当行情订阅限频 | [WS 文档](https://www.gate.com/docs/developers/crossex/ws/en/) |
| 增量 | 有 `snapshot`、`U`、`u`；未说明首帧快照保证、各家断档衔接算法 | [增量频道](https://www.gate.com/docs/developers/crossex/ws/en/#incremental-order-book-subscription) |
| REST 盘口恢复 | 当前 REST 文档未找到 CrossEx 盘口快照接口；不能假定可以直接补快照 | [REST 文档](https://www.gate.com/docs/developers/crossex/en/) |

永续完整限档快照的文档值如下，**文档列出的档位仍须验证**：[官方深度表](https://www.gate.com/docs/developers/crossex/ws/en/#full-limited-level-order-book-subscription)。

| 交易所 | 档位 |
| --- | --- |
| Binance | 5 / 10 / 20 |
| OKX | 1 / 5 |
| Gate | 1 / 5 / 10 / 20 / 50 / 100 |
| Bybit | 1 |
| Kraken | 不支持，要求用增量 |
| Hyperliquid | 1 / 5 / 10 / 20 / 30 / 50 / 100 / 400；本次 400 被拒绝 |

盘口 `ts` 文档仅标为毫秒时间戳，ticker `ts` 明确为交易所时间；不可将接收时间等同源行情时间。盘口数量仅标为 Qty，REST 的 `contract_size` 则已标弃用且称数量统一；这不足以证明 WS 每家数量都已换算，需逐频道核对。[WS 字段](https://www.gate.com/docs/developers/crossex/ws/en/#ticker-subscription) · [REST Symbol](https://www.gate.com/docs/developers/crossex/en/#symbol)

资金费率 WS 给 `r` 和下一结算时间 `T`，不含结算周期。`open_interest` 明确排除 Binance。[资金费率](https://www.gate.com/docs/developers/crossex/ws/en/#futures-funding-rate-subscription) · [持仓量](https://www.gate.com/docs/developers/crossex/ws/en/#futures-open-interest-subscription)

REST `/crossex/market/funding_info` 可提供周期秒数，限频 1 次/秒且需签名；这是当前费率信息，不是历史结算记录。`/crossex/market/tickers` 也需签名、1 次/秒，并提供持仓量字段，是否足以替代每家现有数据需验证。[资金费率 REST](https://www.gate.com/docs/developers/crossex/en/#get-exchange-futures-funding-rate-information) · [Ticker REST](https://www.gate.com/docs/developers/crossex/en/#get-exchange-tickers)

## 本次公开入口轻量验证

证据：[crossex-websocket-probe.json](./crossex-websocket-probe.json)。一次匿名连接，无下单、无私有账户访问；总过程约 35 秒，包含握手等待，有效消息观察窗口约 25 秒，各频道更短。因此只能验证明确拒绝及已收到的数据，不能据此断言长期服务质量。

| 检查 | 本次结果 |
| --- | --- |
| Binance BTC 20 / OKX BTC 5 / Gate BTC 100 / Bybit BTC 1 | 订阅成功并收到对应深度快照 |
| Bybit BTC 50 | 明确拒绝，错误说明只支持 1 档快照 |
| Hyperliquid BTC 400 | 明确拒绝，错误说明仅支持 1 / 5 / 10 / 20；与官网不一致 |
| Hyperliquid BTC 20 | 订阅确认成功，观察窗口内无推送；不能视为盘口已就绪，也不能推断永久不支持 |
| Kraken BTC 增量 | 9,074 条增量，未收到 `snapshot:true` |
| Bybit BTC 增量 | 100 条增量，未收到 `snapshot:true`；首帧 `u=-1` |

Bybit 单条增量包含数百个价格更新，不等于可从空盘口恢复数百档完整深度。所有没有可信初始化的盘口必须保持未就绪。`u=-1` 也说明不能将一个统一的连续序号公式套到所有交易所。

本次接收时间减 `ts` 的均值约 2.4–2.7 秒，最大约 5.8 秒。这混合了时间戳语义、本机时钟偏差、网络、转发和处理延迟；未作校时及原生对照，不能归因于 CrossEx 本身。该结果也不支持承诺统一接入后会消除不同步。

另外做了一次单连接订阅额度验证：[crossex-websocket-subscription-probe.json](./crossex-websocket-subscription-probe.json)。`ticker` 订阅 100 个真实、处于 live 状态的 Binance USDT 合约成功，追加第 101 个返回 `1000102`；`last_price` 一次订阅 101 个也返回相同错误。错误明确指向**每连接每频道累计最多 100 个 symbols**，不是简单拆成多次请求就可以超过的单请求限制。窗口内收到 479 条 ticker 更新，不表示 100 个标的都已逐一验证稳定。首次 TLS 失败及有限重试保留在证据中。本次未用多连接压测，因此没有复测每 IP 连接上限。

### 与历史记录的区别

[旧联调记录](./spread-monitor-handoff.md) 曾记录“每 IP 5 连接、每连接每频道 100 symbols”、增量不保证初始快照、Hyperliquid 拒绝 400 档，以及 Gate/OKX 数量为张数。它们是项目历史实测，不是官网保证，也不是本次连接上限复测。

不要将官网的 `20 uid+channel` 直接换算成匿名入口 `20×100` 个 symbol 的承诺。市值前 N 的规划应先按保守预算，容量实测另行记录。

## 市值前 N 应怎样预算

订阅单位是“交易所 + 市场 + 具体合约”，不是基础资产，也不是页面的买入卖出方向。相同盘口应全后端共享，不能每个方向或每个页面重复订阅。

设选中 N 个资产，每个资产在目标交易所有 `v_i` 个有效合约，则某频道所需订阅数为 `S=Σv_i`。六家交易所且每家只选一个合约时，`S≤6N`；同一资产若另订现货、其他结算币合约，则要额外计数。更通用地，令 `q(v,c,N)` 为交易所 v 在频道 c 下、前 N 资产所需的去重合约数，则 `S_c=Σ_v q(v,c,N)`，按本次额度最少需要 `ceil(S_c/100)` 个承载该频道的连接。多个频道可复用连接，本次已验证单连接承载多个深度频道；实际连接数还取决于分组及隔离策略。每个资产的有向价差数为 `v_i(v_i−1)`，这些方向不需要增加上游订阅。

以下是设计预算，**不是服务商承诺**：假设某一个频道可用 4 个连接，每连接 100 symbols，另留一连接空间给现有业务和恢复，总预算 400 symbols。

| 资产数量 | 平均 4 家合约 | 每个资产都有 6 家合约 |
| --- | --- | --- |
| 30 | 120 | 180 |
| 50 | 200 | 300 |
| 80 | 320 | 480 |
| 100 | 400 | 600 |

因此建议从 20–50 个资产起步，按实际合约数限制总量。这是工程试点选择，不是已验证的持续承载保证。不同深度频道可以复用连接，但每频道预算需分别计算；不能认为 `5×100=500` 是所有频道合计的容量。海力士、汇率等现有业务的连接也必须纳入同一出口 IP 预算。

“市值”也应明确：现有页面的平均持仓量不等于市值。如果要真市值排名，需要基础资产市值来源；股票、大宗商品与加密资产不能直接用同一排名混合。建议加密资产按市值前 N，海力士等非币标的及收藏标的单独加入白名单，总体仍受 symbols 预算约束。

## 推荐取舍

1. **优先统一看盘行情**：精选 20–50 个资产，CrossEx ticker 计算顶层参考价差，funding_rate 展示当前费率；费率周期、历史记录和 Binance 持仓量保留 REST 补充。
2. **容量按可验证深度展示**：完整快照可直接使用；Bybit 标注 1 档受限；Kraken 在解决初始化前不展示可执行容量，或保留原生盘口。顶层 ticker 不能冒充整笔成交均价。
3. **连接共享与主动恢复**：一个订阅管理器统一负责分组、去重、限频、确认、首帧超时、重连与重新订阅。确认成功与盘口可用分开计状态。
4. **筛选在订阅前执行**：资产排名更新做增量订退，不随页面分页变动；设置变动先计算新旧差集，避免每次清空重建全部行情。
5. **先验证再扩大**：统计每个 symbol 的首帧耗时、有效盘口占比、停更次数、双边时间差以及事件循环延迟。用同一校时环境对照原生与 CrossEx，达到目标后再增加 N。

如果选择“完全只用 CrossEx”，可以接受少量标的、浅盘口及部分容量缺失；如果目标仍是六家准确估算多档容量，现阶段不建议移除所有原生适配器。
