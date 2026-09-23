# 黄金代币社区监控方案调研

调研日期：2026-09-23。研究范围：社区原帖、公开源码及治理论坛；本轮没有运行交易脚本、配置凭证或修改交互稿。

## 结论与证据边界

公开材料能确认的做法包括：黄金代币对外部 XAU 报价的偏离监控、代币之间价差、周末观察和抵押资产预言机风控。它们解决的问题不同，不能合并成“所有人都用 PAXG 为基准”，也没有足够样本支持某一种方法是整个社区的标准。

下文区分“源码可核实的方法”“治理建议”“用户观察”。社区帖子只能证明有人提出或使用某种看法；不能证明成交价格、盈利能力、发行方问题或因果解释成立。

## 社区和治理的一手证据

| 来源与日期 | 实际做法或讨论 | 对本项目的启示及限制 |
| --- | --- | --- |
| [pbraun9/paxg-arbitrage](https://github.com/pbraun9/paxg-arbitrage)，2026-09-23 查阅，仓库页面未核实发布日期 | README 描述每 5 分钟比较 XAU 与 PAXG，用最近 100 点的漂移均值衡量当前偏离，并提供终端图。 | 这是确实可查看代码的社区实现，支持同时看“绝对偏离”和“较历史正常价差的偏离”；不是秒级盘口监控，也未证明策略有效。 |
| [上述项目 compare-paxg.ksh 源码](https://github.com/pbraun9/paxg-arbitrage/blob/main/compare-paxg.ksh)，2026-09-23 查阅 | 实际主路径读取 XE 的 XAU/USD 与 Binance 的 PAXGUSDT 最新成交价，相减；GoldAPI 等是注释中的备选。触发条件后发送邮件，另有真实下单逻辑。 | 已读主脚本未见 USDT/USD 汇率修正、盘口深度、时间同步和周末失效检查；不能原样作为产品实现，也不能把注释的供应商当成实际数据源。本轮未执行。 |
| [Aave PAXG 上线治理提案](https://governance.aave.com/t/arfc-add-paxg-to-aave-v3-main-instance-on-ethereum/19849)，2024-11-19，更新 2024-11-29 | 风险评估明确讨论非交易时间 PAXG 对黄金的偏离，并推荐以 XAU 预言机估值，而非完全跟随代币市场。 | 这是抵押品估值与清算风险设计，不能直接用于判断可成交买入机会。方案中的借贷参数及历史统计也不应搬成我们的告警阈值。 |
| [Aave PAXG 评估集合](https://governance.aave.com/t/paxos-gold-paxg-on-aave-ethereum-assessments/25359)，2026-07-22 与 2026-08-19 发帖 | 技术评估讨论 PAXG/USD，风险评估另讨论 XAU/USD，并指出按黄金现货估值可能忽略代币折价。 | 同一治理社区也会根据目标区分 token feed 和 underlying feed，并非唯一答案；发帖和建议本身不等于链上已执行。本轮未核对最终治理执行。 |
| [Reddit：Pax Gold 2,500 per ounce](https://www.reddit.com/r/Gold/comments/1c3owl9/pax_gold_2500_per_ounce/)，2024-04-14 | 发帖及回复把周末 PAXG 波动与传统黄金收盘价、XAUT 放在一起比较；对价格含义存在争议。 | 证明用户会看多个参照而非只看币价。帖子中的极值与“脱锚”归因未经本研究独立验证，不作为行情事实。 |
| [Reddit：What happens to tokenised gold when the gold market closes?](https://www.reddit.com/r/defi/comments/1w9java/what_happens_to_tokenised_gold_when_the_gold/)，2026-09-23 查阅 | 用户讨论周末 token 可交易而现货参照／赎回服务可能关闭；方案包括底层参考价、保守 LTV、关注清算价格，也有人认为套利足以维持。 | 明确不是一致意见。搜索摘要与页面相对日期不一致，因此不推定精确发表日；匿名观点与个案不能作为市场规则或收益保证。 |

## 开源与看板的补充核验

以下由并行主研究核实于 2026-09-23；只有源码可核实方法，不代表成熟度、运行表现或社区普及率。

| 对象与证据等级 | 方案 | 核验限制 |
| --- | --- | --- |
| [GoldArb](https://github.com/Patrick-code-Bot/GoldArb)，小型开源项目；[策略源码](https://raw.githubusercontent.com/Patrick-code-Bot/GoldArb/main/paxg_xaut_grid_strategy.py) | 同所 PAXG/XAUT 永续价差，读取 bid/ask，以中间价差计算，分档参数包括 0.1%，另有 1.5% 极端偏离暂停参数。 | 这是永续相对价值策略。源码有 market IOC 下单，与 README 的全 maker 描述不一致；收益声明未验证，不作为成果引用。参数只是作者选择，不是行业标准。 |
| [TruePremium](https://www.truesourcemetals.com/premium-tracker/)，第三方看板自述 | 区分 Live vs Live 与 Fix vs Fix；实时以 CoinGecko 代币聚合价对 Yahoo 近月 CME/NYMEX 期货代理；日度 PAXG 用 CF Benchmarks 对 LBMA。 | 期货代理不是现货，其他代币日收盘与 LBMA 存在时差。页面和方法文字有不一致，仅借鉴双视图，不背书报价精确性、接口可用性或套利可执行性。 |

## 对我们交互与告警的建议（工程推论）

- 将“支付／显示币种（USDT、USDC、USD）”与“比较基准”分开。前者是单位，后者回答正在测量哪一种偏离。
- 黄金现货提供三个独立观察项：同一资产跨所差价、PAXG 与 XAUT 相对价差、对外部 XAU/USD 的溢折价；不要只保留一个“异常”数值。
- “相对 XAU 折价超过 1%”与“相对 PAXG 折价超过 1%”必须使用不同标签。两个代币一起偏离黄金时，代币相对价差看不出来。
- 价格质量展示来源、原始交易对、买一卖一、盘口金额、时间戳、参考市场状态。可成交比较使用买入端卖价与卖出端买价，并另算费用和容量；最新成交／中间价只作为观察指标。
- 外部参考休市时显示“相对上次收盘价偏离”，不伪装成实时金价偏离。跨所及 token-token 比较仍可运行，但同样需要报价时效与流动性检查。
- 默认阈值和连续时间是产品配置，不是社区验证结论；应保留原始偏离曲线和事件，并在历史回放后调整。
- 黄金现货、永续与 ETF 代币分组；永续要另看指数、标记价和资金费率，不能把永续价差策略当作实物黄金套利。

## 未解决项

仍需选择可合法使用的实时 XAU 数据源及授权方式，实测其时间戳、交易时段和延迟；需要针对现有支持交易所核实真实交易对、深度和费用。公开仓库不等于已验证可运行服务，网页看板也不等于提供可集成 API。
