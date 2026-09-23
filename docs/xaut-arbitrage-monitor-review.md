# xaut-arbitrage-monitor 源码核查

核查日期：2026-09-23。对象：[heibais1986/xaut-arbitrage-monitor](https://github.com/heibais1986/xaut-arbitrage-monitor)，固定提交 [d8302927215732bfe690bc771fc95f513041f407](https://github.com/heibais1986/xaut-arbitrage-monitor/tree/d8302927215732bfe690bc771fc95f513041f407)。只读取源码并隔离执行纯计算器复现；未安装依赖、启动监控或配置密钥。未发行情／交易请求，网络请求仅用于读取 GitHub 源码。另用独立 Node 表达式验证毫秒字符串日期转换问题。

## 结论

它是 **OKX 与 Uniswap 之间的同资产 XAUT 价差监控原型**，不以国际黄金 XAU/USD 为价值基准，也不负责 PAXG/XAUT 跨资产比较。模块拆分及数量／流动性意识值得借鉴，但当前利润计算存在严重数量错配，不能直接相信“盈利机会”输出；功能描述也超出实际完成度。[主流程][monitor]、[计算器][calculator]

## 实际工作链路

1. 默认启动后立即检查一次，随后按分钟 cron 检查，默认每分钟；非 WebSocket 实时订阅。并行读取 OKX ticker、20 档盘口和静态手续费，另取 DEX 数据。[配置][config]、[主流程][monitor]
2. OKX 报价固定为 `XAUT-USDT`；计算了 0.1、0.5、1、2、5 XAUT 的盘口成交均价。DEX 固定调用 `getFullDEXInfo(1)`，生成 1 XAUT 买卖估算。[主流程][monitor]
3. 计算器再对上述五档数量计算双向“利润”，保存每日 JSON；内存只留最近 100 条价格历史。[主流程][monitor]、[计算器][calculator]
4. 所谓通知当前只在控制台输出，Telegram 配置没有接入发送；没有实际自动交易主流程。[主流程][monitor]、[配置][config]

## 关键问题

| 严重度 | 核实发现 | 影响 |
| --- | --- | --- |
| 严重 | DEX 只报价 1 XAUT，计算器循环多档数量时复用该笔 DEX 总成本／总收入，不按数量重新报价。 | 例如 0.1 XAUT 的 CEX 买入成本配上 1 XAUT 的 DEX 卖出收入，或者 5 XAUT 的 CEX 卖出收入配上 1 XAUT 的 DEX 买入成本，会产生虚假巨额利润。[主流程][monitor]、[计算器][calculator] |
| 高 | 已计算的 CEX `executionPrices` 和 `fee` 未参与利润计算，实际按买一／卖一乘数量。 | 不考虑相应数量吃单深度，读取盘口不等于计算已覆盖滑点。[主流程][monitor]、[计算器][calculator] |
| 高 | CEX→DEX 未完整计入 DEX 手续费及 Gas；DEX→CEX 使用简单附加的 0.3%，底层常数乘积报价本身未统一处理交易费。Gas 和路由报价相关方法未完整进入主计算路径。 | 两方向成本口径不一致，无法视为净收益估算。[DEX][dex]、[计算器][calculator] |
| 高 | OKX 公共行情调用也统一生成签名；缺少 secret 时 `createHmac` 失败，而不是退回匿名公共查询。 | “配置缺失仅限制部分功能”实际可能导致行情完全获取失败。[OKX 客户端][okx] |
| 高 | ticker 与 book 对 `ts` 直接 `new Date(ts).toISOString()`。独立 Node 验证 `new Date('1597026383085')` 为 Invalid Date，转成 Number 后正常。 | 对常见毫秒数字字符串响应，会抛异常并被客户端捕获为 null。没有声称本轮已经实测该交易所响应。[OKX 客户端][okx] |
| 高 | DEX 配置明确采用名为 `OLD` 的合约，`NEW:null`，资产身份与迁移状态没有核实闭环。 | 不能认定所读链上池与 CEX 可充提资产完全一致；仓库注释称“已迁移”不是本研究确认的链上事实。[配置][config]、[DEX][dex] |
| 中 | 以 ETH/USDT 换算却命名 USD，未校正 USDT/USD；没有外部 XAU 基准。 | 只能描述 USDT 计价的相对市场价差，不能据此判断偏离国际黄金价格。[DEX][dex] |
| 中 | HTTP 无明确 timeout；没有报价最大年龄、跨源采样时差校验、单次检查互斥或告警去重。 | 请求可能拖延并与下一轮重叠；时间不同步的报价可能被比较，同一机会会重复打印。[OKX 客户端][okx]、[主流程][monitor] |
| 中 | 高风险条目仅展示，`bestOpportunity` 未因 HIGH 风险统一排除；提现状态读取存在但未进入主监控。 | 不能把出现最佳机会解读为流动性、充提及执行条件已满足。[主流程][monitor]、[计算器][calculator]、[OKX 客户端][okx] |
| 中 | 测试脚本以打印和 try/catch 为主，没有断言；单项失败后仍可能打印“所有测试完成”。 | 不是能防住数量错配、手续费遗漏、失效报价的回归测试。[测试脚本][test] |

## 纯计算器隔离复现

主研究取上述固定提交的计算器，移除 import 后在隔离 VM 注入配置和固定数据：CEX 最新价／买一／卖一均 4,000；DEX 价格 4,000，`execution.testAmount=1`，买入成本／卖出收入均 4,000，滑点为零且流动性充足。两市场同价，扣费后预期不应存在正套利收益。[计算器][calculator]

实际 `analyzeOpportunity` 却给出 CEX→DEX 0.1 XAUT 利润 **3,579.6**、DEX→CEX 5 XAUT 利润 **15,948**，均标记可盈利。这直接复现了数量错配，不依赖真实市场行情；并不表示现实存在这些利润。

## 对本项目的可借鉴部分

- 借鉴 CEX／DEX 适配器、计算器、监控调度的职责拆分；借鉴“按指定数量比较成交成本”，但必须让两条腿使用完全相同的资产和数量。
- 首版仍优先做现有交易所的同资产跨所监控；若接 DEX，必须核实链、合约、资产可充提关系，按每个数量重新读取可靠路由报价，保留区块高度与时间戳。
- 页面分别显示原始价差、指定数量可成交价差、费用后估算；手续费、Gas、充提费用和时效缺失时标为“未完成估算”，不产生“可盈利”结论。
- “国际金价偏离”作为独立指标接入真实 XAU 参考；这个仓库不能替代该数据源。
- 增加固定行情测试：同价市场扣费后不盈利、数量一致性、深度不足、报价过期、费用缺失、合约不一致、重复告警和断线恢复。

这些是基于源码缺口提出的工程建议，不是对该仓库真实盈利能力或实时可运行性的实测结论。

[monitor]: https://github.com/heibais1986/xaut-arbitrage-monitor/blob/d8302927215732bfe690bc771fc95f513041f407/src/monitor.js
[config]: https://github.com/heibais1986/xaut-arbitrage-monitor/blob/d8302927215732bfe690bc771fc95f513041f407/src/config.js
[okx]: https://github.com/heibais1986/xaut-arbitrage-monitor/blob/d8302927215732bfe690bc771fc95f513041f407/src/okx-client.js
[test]: https://github.com/heibais1986/xaut-arbitrage-monitor/blob/d8302927215732bfe690bc771fc95f513041f407/src/test.js
[dex]: https://github.com/heibais1986/xaut-arbitrage-monitor/blob/d8302927215732bfe690bc771fc95f513041f407/src/dex-client.js
[calculator]: https://github.com/heibais1986/xaut-arbitrage-monitor/blob/d8302927215732bfe690bc771fc95f513041f407/src/arbitrage-calculator.js
