# 黄金监控：标的机制与参考价格

核实日期：2026-09-23。本文依据发行方、基金管理人和基准管理机构资料，评估当前交互原型的黄金比较逻辑。只讨论产品机制；不表示下列产品已在本项目覆盖的六家交易所全部上市。

## 先确定比较的是什么

**USDT 是报价币，不是黄金本身的价值基准；PAXG/USDT 是一个黄金代币的市场价格，也不等于唯一的国际金价。** 当前原型可以表达“XAUT 比 PAXG 便宜”，但不能据此确认“XAUT 偏离国际金价”。产品分类、计量单位、参考来源和时间必须同时明确。

| 标的 | 机制及对应资产 | 应优先比较什么 |
|---|---|---|
| PAXG | 每枚代表一纯金衡盎司 London Good Delivery 黄金，金条分配托管；可依条款兑换美元、未分配黄金或实物金条 | 同一 PAXG 的跨所报价；或统一币种、单位后的现货黄金参考 |
| XAUT / XAU₮ | 每枚对应储备中特定金条的一纯金衡盎司所有权权益；可依条款整条赎回 | 同一 XAUT 的跨所报价；或统一口径后的黄金参考 |
| GLDon | Ondo 对 SPDR Gold Shares（GLD）的代币化经济敞口；GLD 持有黄金并扣除信托费用 | GLD 对应的代币参考价值，不能把一枚当成一盎司 |
| IAUon | Ondo 对 iShares Gold Trust（IAU）的代币化经济敞口 | IAU 对应的代币参考价值，不能与 PAXG 原始单价直接相比 |
| 黄金永续／期货 | 对指定指数或到期月份的衍生品敞口，不等同实物黄金份额 | 该合约自己的指数、现货基差或同到期合约；单独展示资金费率与结算规则 |

PAXG 机制依据 [Paxos 法律条款](https://www.paxos.com/terms-and-conditions/pax-gold-terms-conditions)；XAUT 依据 [Tether Gold 法律条款](https://gold.tether.to/legal/)。GLDon 由 [Ondo 产品页](https://app.ondo.finance/assets/gldon)确认，底层机制见 [GLD 官方说明](https://www.spdrgoldshares.com/usa/gld/)。IAUon 的发行方产品页为 [Ondo IAUon](https://app.ondo.finance/assets/iauon)，本次该动态页面正文无法提取，其标的关系另由 [BitMart 官方产品介绍](https://bitmart.zendesk.com/hc/en-us/articles/45389000027035-iShares-Gold-Trust-Ondo-Tokenized-IAUON)确认；底层 IAU 见 [iShares 官方产品页](https://www.ishares.com/us/products/239561/iau-ishares-gold-trust-fund)。

### 实物支持不意味着随时无成本兑换

PAXG 的直接实物赎回按整根金条办理，条款要求每根至少提交 430 PAXG 加相应费用，再按实际金条重量调整；必须拥有发行方账户，可能有额外尽调。XAUT 的实物赎回也按整根金条办理，条款以 430 枚作为覆盖金条重量的申请安排，再按实际重量结算。这不等于散户持有一枚即可立即领取一盎司金条。[Paxos 赎回条款第 11 节](https://www.paxos.com/terms-and-conditions/pax-gold-terms-conditions)、[Tether Gold 赎回条款](https://gold.tether.to/legal/)

由此推断：发行和赎回、交易所套利会促使代币价格接近黄金价值，但费用、资格、处理时间、交割地点及市场流动性都会形成价差；1% 只能作为监控阈值，不能自动解释成无风险套利。

Ondo 代币设计为底层证券的总回报跟踪工具，考虑股息再投资及公司行为。不能永久硬编码“一枚等于一股”，也不能硬编码一枚对应一盎司。黄金 ETF 自身还存在费用与净值口径，因此应使用当时有效的发行方换算系数和底层资产参考。[Ondo 产品机制](https://ondo.finance/ondo-stocks)、[Ondo 代币化证券说明](https://ondo.finance/learn/tokenized-rwas/tokenized-stocks-and-etfs)

## “国际金价”需要指定具体来源

| 名称 | 含义 | 监控用途 |
|---|---|---|
| LBMA Gold Price AM／PM | 伦敦黄金基准拍卖，伦敦时间 10:30、15:00 启动；美元／金衡盎司 | 日度估值对照，不能冒充每秒更新的行情 |
| 实时 XAU/USD | 提供方给出的黄金／美元实时现货报价或聚合报价；必须确认来源、买卖价口径、延迟和交易时段 | 有合适数据源时用于黄金相对现货偏离 |
| PAXG 聚合价格 | 数家交易所的 PAXG 市场参考 | 代币之间的相对比较；无法独立检测 PAXG 自身整体偏离黄金 |

LBMA 基准并非周末持续发布，数据使用与再分发还涉及授权；不能把最后一笔 AM／PM 定盘值无限视为实时有效。[LBMA 基准时间说明](https://www.lbma.org.uk/prices-and-data/about-lbma-daily-auction-prices)、[LBMA 数据与许可说明](https://www.lbma.org.uk/prices-and-data/lbma-precious-metal-prices)

黄金批发市场同时存在 OTC 与交易所市场，OTC 交易可以由双方协商价格，因此“国际金价”不是所有场所唯一且必须完全一致的成交价。[世界黄金协会：黄金批发交易](https://www.gold.org/about-us/what-we-do/market-infrastructure/gold-trading-wholesale-market)

## 当前原型的问题与建议

检查对象为 [交互原型](../apps/frontend/src/stablecoin-monitor.prototype.html)。当前黄金数据只有 PAXG/USDT、XAUT/USDT 两条模拟记录；黄金参考值固定为 4,000 USDT，界面写有“4 家来源”，代码没有实际四家采集与聚合。`rows()` 使用 `价格 / units / 固定参考价`。这些均为演示逻辑，不能直接接入生产。

| 证据 | 判断 | 实施方向 |
|---|---|---|
| PAXG/XAUT 为黄金份额，PAXG 自身也是市场交易资产 | PAXG 聚合价只证明相对 PAXG 的贵便宜 | 改称“PAXG 市场参考”，显示组成、时间和用途；不能标“国际金价” |
| 原型只校验交易报价 age，参考本身固定且无时间 | 正式接入后参考过期会制造异常 | 同时校验报价、参考、汇率时效；休市／参考不可用独立展示 |
| 金属计算不处理支付币汇率 | 加入 USDC 市场后，USDC 数字不能直接除以 USDT 基准 | 比较前换到相同货币；显示实际汇率，不默认 USDT=USDC=USD |
| ETF 份额与实物黄金代币单位不同 | 不能把全部黄金名称放进每枚单价榜 | 拆成实物黄金代币、黄金 ETF 代币、黄金合约三组 |
| 卖一与参考中间价比较 | 得到估值折价，不是可成交套利收益 | 文案使用“相对折价”；可成交价差另用买入卖一、卖出买一及费用计算 |

建议将页面拆成两个明确的观察模式：

1. **同标的跨所价差（默认）**：选择 PAXG 或 XAUT，比较相同资产各平台的买卖报价。可同支付币直接比较，跨支付币必须换算。该模式减少对外部国际金价源的依赖。
2. **相对参考折价**：明确选择“现货黄金 XAU/USD”或“PAXG 市场参考”；显示参考来源、单位、币种、时间和市场状态。XAU/USD 未接入时显示未接入，不能静默改用 PAXG 并保持原标签。

实物黄金代币相对 XAU/USD 的估值公式为：

```text
报价币为 Q
每盎司美元买入价 = 代币卖一价（Q/枚）× Q/USD 汇率（USD/Q）÷ 黄金份额（盎司/枚）
相对比值 = 每盎司美元买入价 ÷ XAU/USD 参考价（USD/盎司）
相对比值 < 0.99 → 相对参考折价超过 1%
```

这是一条估值公式，不包括执行汇率时的方向、手续费和滑点；若要输出套利金额，必须按实际交易路径选择 bid/ask，并计算可成交深度。示例：金价为 4,000 USD/盎司且 1 USDT=0.98 USD 时，等值黄金约为 4,081.63 USDT/盎司，不能仍把 4,000 USDT 当作美元金价。

PAXG 与 XAUT 同时偏离外部金价时，用其中一个作为唯一基准可能完全看不到共同偏离；反过来，PAXG 溢价也会让正常的 XAUT 看似折价。因此保留 PAXG 相对比较有价值，但需与外部黄金参考分开命名和报警。

## 本次边界

已核实的交易所产品例子进一步说明分类必要性：

| 产品 | 官方口径 | 对监控的影响 |
|---|---|---|
| Binance XAUUSDT | USDT 结算的黄金永续，使用多提供方指数；休市时有指数沿用安排 | 是合约与指数偏离，不是购买实物黄金代币。[Binance 说明](https://www.binance.com/id/learn/binance-futures-tradfi-perpetual-contracts) |
| OKX XAU 相关指数 | 2026 年 3 月调整的指数成分包括 PAXG、Pyth 与传统金融来源 | 该指数可能已含 PAXG，不能将其当完全独立于 PAXG 的现货基准。[OKX 调整公告](https://www.okx.com/en-au/help/okx-to-adjust-indexes-for-xau-xag-and-funding-rate-for-all-tradfi-perpetual) |
| xyz:GOLD | Trade.xyz 规格定义为一金衡盎司黄金的美元现货参考 XAU/USD | 与 PAXG 代币永续区分，按自己的指数规则判断。[Trade.xyz 官方规格](https://docs.trade.xyz/perpetuals/specifications-and-schedules/specification-index) |
| GLDx | Kraken xStocks 列出的 SPDR Gold Shares 产品 | 按 GLD 份额经济敞口比较，不能按一枚一盎司比较。[Kraken xStocks](https://www.kraken.com/xstocks) |

合约数据模型应分别记录**报价单位、指数单位、保证金币、结算币**。不能因为使用 USDC 保证金，就推断屏幕中的价格单位也是 USDC；是否换算及如何换算须服从具体合约规格。

本文没有修改 HTML，也没有接入真实行情。黄金衍生品的具体指数、合约单位与各交易所是否上市，应按当前市场目录和官方合约规则逐项核实，不能仅凭交易代码中出现 GOLD、XAU、PAXG 就归到相同资产。白银与石油也需要独立的标的身份、计量单位和产品类型规则，不能直接复制黄金的每盎司参照。
