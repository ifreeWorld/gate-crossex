# SK 海力士资金费率套利策略设计

日期：2026-08-09

## 1. 设计决策

新增独立的 `sk_hynix_carry` 策略，与现有 `premium` 策略并存。

- 现有路由：`/strategies/sk-hynix-premium`
- 新路由：`/strategies/sk-hynix-funding`
- 不改变现有 `premium` 行为和已持久化记录。
- 第一阶段只实现只读功能，不连接真实 IBKR 或交易所交易账户，也不提供可点击的下单按钮。
- 只读行情、模拟执行、恢复和补偿流程验证完成后，仍需用户再次明确批准，才可进入真实执行阶段。

独立原型 `docs/sk-hynix-tws-strategy-demo.html` 仅作为设计参考，不是生产代码。在用户决定是否纳入版本控制前，该文件继续保留在工作区。

## 2. 策略定义

开仓方向：

- 通过 IBKR 买入已验证的 SK 海力士股票标的。
- 在支持的加密交易所做空已验证且经济敞口等价的永续合约。

平仓方向：

- 仅卖出本策略持有的股票数量。
- 仅买入本策略建立的永续空头数量，并在交易所侧强制 Reduce-only。

系统不能根据相似的代码名称推断标的等价性。只有持久化标的映射状态为 `VERIFIED`，并包含准确的 IBKR 合约、永续合约、经济换算比例、币种和验证信息时，该交易对才具备交易资格。

## 3. 范围

### 包含内容

- 独立 React 路由和策略菜单入口。
- 机会排行、选中标的详情、订单预览、双腿执行轨道和策略持仓展示。
- 根据目标名义金额生成开仓预览。
- 根据策略实际持仓生成平仓预览，默认 100%，支持 25%、50%、75% 和 100%。
- 使用十进制安全算法计算 VWAP、汇率归一化、对冲数量和预计收益。
- 明确展示行情新鲜度、实时/延迟状态、股票市场状态、资金费率周期和估算假设。
- 定义独立的只读 API 边界，后续可接入 IBKR、交易所和汇率适配器。
- 在真实执行协调器之前，先实现独立的双腿模拟执行协调器。
- 为后续真实执行阶段设计可恢复、可补偿、可进入人工干预状态的持久化模型。

### 第一阶段不包含

- 真实 IBKR 登录、行情订阅或订单提交。
- 真实交易所订单提交。
- 自动安装或管理 TWS、IB Gateway 或 IBC。
- 把原型中的合约、换算比例、价格或资金费率周期当作已验证业务数据。
- 修改现有 CrossEx `premium` 策略。

## 4. 现有系统约束

当前仓库是本地单用户 React/Vite + Fastify 应用。API 边界使用运行时 Schema 和十进制字符串，浏览器只连接本地后端。

不能只在现有交易执行层的交易所枚举中加入 `IBKR`：

- 当前执行层只接受加密交易所标识。
- 当前订单代码必须符合永续合约命名格式。
- 两条腿共用同一个 CrossEx Gateway、余额模型和私有事件流。
- 现有 `premium` 策略默认两条腿都是加密衍生品。

因此，新策略使用独立的领域模型和协调器。可以复用 SQLite、本地 HTTP/WebSocket、交易会话锁、日志约定、十进制处理和 UI 基础样式，但不能复用现有策略订单协议。

## 5. 前端设计

### 5.1 文件边界

新增独立功能目录，不继续扩张 `strategy-route.tsx`：

```text
apps/frontend/src/sk-hynix-carry/
  route.tsx
  opportunity-table.tsx
  instrument-pair.tsx
  order-ticket.tsx
  execution-lanes.tsx
  positions-panel.tsx
  calculations.ts
  calculations.test.ts
  close-sizing.ts
  close-sizing.test.ts
```

`route.tsx` 只负责页面组合、机会选择和展示状态。计算文件只包含确定性的前端展示辅助逻辑，不能作为真实交易的权威计算结果。

在 `StrategyRouteKind` 中新增内部键 `carry`，并映射到 `/strategies/sk-hynix-funding`。同时增加懒加载入口和策略菜单项。该路由与 `PremiumStrategyView` 完全独立。

### 5.2 页面信息层级

保留原型中有效的信息层级：

1. 连接和交易资格摘要。
2. 基于目标金额和持有周期的机会排行。
3. 已验证标的映射、行情、汇率归一化和估算假设。
4. 包含数量及剩余敞口预览的开仓/平仓面板。
5. 双腿执行状态轨道。
6. 策略范围内的持仓、订单、成交、资金费、成本和盈亏。

复用现有主题、国际化、`terminal-panel` 视觉风格、无障碍规范和路由懒加载。不能通过 iframe 嵌入原型，也不能复制原型的全局 CSS。

### 5.3 只读行为

第一阶段使用通过运行时 Schema 验证的 fixture，由后端通过未来真实只读行情将使用的同一套 API 边界返回。

- 所有数值明确标记为示例数据。
- 连接状态显示为 `READ_ONLY_FIXTURE`。
- 下单按钮保持禁用，文字为“只读预览”。
- 不显示“模拟交易”，因为当前应用没有模拟成交和持仓账本。
- 标的未验证、行情过期、IBKR 延迟行情、股票闭市、盘口深度缺失或汇率缺失时，该机会不可交易。

### 5.4 开仓和平仓数量

开仓从目标计价币名义金额开始：

1. 将 IBKR 可执行股票价格换算为策略报告币种。
2. 将股票数量向下取整至允许的交易单位；在合约元数据验证前，默认只允许整数股。
3. 通过已验证映射换算股票经济敞口。
4. 将永续数量向下取整至交易所步长，且不能超过股票经济敞口。
5. 展示剩余经济敞口和汇率敞口。

平仓从策略账本开始，不接受新的名义金额：

1. 读取所选策略剩余的 IBKR 股数和永续数量。
2. 默认选择 100%。
3. 将选择比例换算成可执行股票数量。
4. 根据本策略实际剩余成交比例计算对应永续数量。
5. 按交易所约束取整；最终全部平仓操作使用剩余的准确可执行数量。
6. 拒绝超过本策略持仓的数量。
7. 展示平仓后两边剩余持仓和剩余净敞口。

## 6. 共享数据协议

在 `packages/shared-types` 中新增独立 Schema；第一阶段不修改现有 `StrategyConfigSchema`。

### 6.1 标的映射

```text
CarryInstrumentMapping
  mappingId
  status: UNVERIFIED | VERIFIED | SUSPENDED
  economicUnderlyingId
  ibkrContract:
    conId, symbol, localSymbol, secType, exchange, primaryExchange,
    currency, timezone, tradingHours, lotSize
  perpContract:
    venue, symbol, base, quote, settlementCurrency,
    contractMultiplier, quantityStep, minimumQuantity
  equityUnitsPerPerpUnit
  verificationSource
  verifiedAt
```

映射属于配置数据，不能从行情或代码名称推断。生产环境只有 `VERIFIED` 映射具备交易资格；fixture 映射必须明确标记为示例。

### 6.2 行情快照

```text
CarryQuoteSet
  mappingId
  snapshotId
  ibkrBook: bids, asks, timestamp, marketDataType, marketState
  perpBook: bids, asks, timestamp
  funding: rate, intervalSeconds, nextFundingAt, predictionSource
  fxQuotes: 每条换算边的 pair, bid, ask, timestamp
  capturedAt
```

`marketDataType` 区分 IBKR 实时、冻结、延迟和延迟冻结行情。除非未来制定并明确批准其他策略，只有实时行情具备执行资格。

### 6.3 机会和持仓

```text
CarryOpportunity
  mappingId, snapshotId, requestedNotional, horizonSeconds
  equityQuantity, perpQuantity
  equityVwap, perpVwap
  openingSpreadBps
  expectedFundingBps
  costBreakdown
  expectedExitBasisBps
  expectedNetReturnBps, expectedNetReturnAmount
  residualEconomicExposure, residualFxExposure
  assumptions, eligibility, ineligibilityReasons

CarryPosition
  strategyId, mappingId
  remainingEquityQuantity, remainingPerpQuantity
  averageEntryPrices
  realizedAndAccruedFunding
  commissionsAndFees
  residualEconomicExposure, residualFxExposure
  openedAt, updatedAt
```

API 边界的所有金额和数量都使用十进制字符串。时间戳统一使用 ISO 8601 UTC 字符串。

## 7. 计算规则

### 7.1 可执行价格

开仓使用：

- IBKR 股票买入数量对应的 Ask 侧 VWAP。
- 永续卖出数量对应的 Bid 侧 VWAP。
- 每条币种换算路径上的保守可执行汇率。

平仓使用相反方向：

- IBKR 股票 Bid 侧 VWAP。
- 永续 Ask 侧 VWAP。

如果任一盘口无法在配置的最大滑点内满足目标数量，则不生成收益估算，且禁止执行。

### 7.2 开仓价差

两边价格换算为同一报告币种和同一经济单位后：

```text
openingSpreadBps = (perpSellVwap / equityBuyVwap - 1) * 10,000
```

正数表示开仓价差有利，负数表示开仓需要付出价差成本。

### 7.3 资金费率

资金费按永续空头的带符号现金流计算：

```text
expectedFundingIncome = perpNotional * expectedSignedFundingRate * expectedSettlementCount
```

空头收到的正资金费为正收益，负资金费为成本。页面必须显示下一结算时间、结算周期、预测来源、持有周期和预计结算次数，不能暗示当前费率未来保持不变。

### 7.4 预计收益

```text
expectedNetReturn
  = openingSpreadValue
  + expectedFundingIncome
  - ibkrEntryCommission
  - ibkrEstimatedExitCommission
  - perpEntryFee
  - perpEstimatedExitFee
  - entryAndExitSlippage
  - fxConversionCost
  - equityFinancingAndHoldingCost
  - taxesAndInstrumentSpecificCosts
  - expectedExitBasisCost
```

页面统一使用“预计策略收益”，不能使用“最大利润”或“保证收益”。结果必须同时展示成本拆分和计算假设。

## 8. 只读后端边界

新增独立于 `TradingRuntime` 的功能服务：

```text
CarryMarketService
  读取标的映射
  接收股票、永续、资金费率和汇率快照
  验证行情新鲜度和交易资格
  计算基于 VWAP 的机会
  发布归一化快照
```

首批本地接口：

```text
GET /api/sk-hynix-carry/mappings
GET /api/sk-hynix-carry/opportunities?notional=...&horizonSeconds=...
GET /api/sk-hynix-carry/positions
```

后续在终端 WebSocket 中增加该功能专用的快照和更新消息，不能把 IBKR 数据伪装成 CrossEx `market.update`。

浏览器不能直接连接 TWS、IB Gateway、交易所或汇率服务商。

## 9. 后续阶段的适配器边界

```text
IbkrMarketDataAdapter
  合约详情、行情类型、盘口/深度、交易时段

PerpMarketDataAdapter
  合约元数据、盘口深度、资金费率、结算周期、下次结算时间

FxMarketDataAdapter
  带时间戳的可执行汇率

IbkrExecutionAdapter
  提交、撤单、订单状态、成交、持仓、断线恢复

PerpExecutionAdapter
  提交、撤单、订单状态、成交、持仓、Reduce-only
```

只有兼容性验证确认维护状态、Node 版本支持、合约查询、行情深度、订单回调、成交回报、重连和订单 ID 恢复后，才选择 TWS Node 库。领域接口不能依赖某个尚未验证的第三方封装。

## 10. 模拟和真实执行设计

### 10.1 环境隔离

模拟和真实执行实现相同的协调器接口，但使用不同适配器，并持久化明确的 `environment`。fixture 或模拟记录绝不能由真实适配器恢复执行。

### 10.2 一键并发提交

用户的一次操作创建不可变执行批次，包含：

- 策略 ID 和映射 ID；
- 行情快照 ID；
- 请求数量和归一化后的数量；
- 两条腿的订单意图；
- 最大滑点；
- 幂等键。

服务端预检通过后，协调器并发启动两条腿的提交。IBKR 提交后不存在人工确认环节，也不能等待 IBKR 确认后才提交永续订单。并发只能减少时间差，不能宣称原子成交。

### 10.3 状态模型

每条腿记录：

```text
SUBMITTING
ACKNOWLEDGED
PARTIALLY_FILLED
FILLED
FAILED
CANCEL_PENDING
CANCELLED
UNKNOWN
```

执行批次派生以下状态：

```text
submitting
acknowledged
partially_filled
filled
failed
compensating
manual_intervention
```

网络结果不明确时进入 `UNKNOWN`，不能直接标记为 `FAILED`；必须通过交易场所对账确认远端状态。

### 10.4 补偿策略

补偿操作必须有次数和时间限制，并且只能降低风险：

1. 对不明确结果采取操作前，先对账两边状态。
2. 尽可能撤销未成交剩余订单。
3. 比较实际成交的经济敞口，不能比较原始请求数量。
4. 只提交将失衡敞口降低到限制内所需的数量。
5. 达到配置的尝试次数或时间上限后停止自动补偿。
6. 如果无法证明恢复平衡，进入 `manual_intervention`，并显示准确敞口和远端订单标识。

通用重试不能重复提交订单。所有初始订单和修复订单都必须使用持久化的幂等 ID 或客户端订单 ID。

## 11. 后续执行阶段的持久化设计

新增独立数据表，不复用当前只适合加密交易的执行记录：

```text
carry_instrument_mappings
carry_strategy_positions
carry_execution_batches
carry_execution_legs
carry_fills
carry_funding_cashflows
```

持久化恢复所需的原始交易场所标识、归一化数量、成交关联、状态变化、失败原因和时间戳。数据库迁移继续遵守现有不可修改及校验和规则。

进程重启后，必须先通过 IBKR 和交易所对所有非终态批次完成对账，之后才允许对同一策略持仓执行新操作。

## 12. 安全和交易资格

出现以下任一情况时禁止开仓：

- 标的映射未验证。
- IBKR 合约身份或权限不可用。
- 股票或汇率行情过期、延迟或缺失。
- 永续行情、深度、元数据或资金费率周期不可用。
- 股票市场闭市；除非未来另行制定并明确批准允许交易的时段策略。
- 任一侧没有足够可执行深度。
- 数量不符合交易单位、步长或最小数量要求。
- 剩余敞口超过配置限制。
- TWS/Gateway、交易所数据流或对账状态异常。
- 同一策略持仓已存在未结束的执行批次。

页面必须解释每一项未通过的检查，不能仅因为存在可显示价格就允许执行。

## 13. 测试设计

### 前端

- 路由序列化和刷新恢复。
- 机会选择与下单面板联动。
- 开仓/平仓模式切换。
- 25%、50%、75%、100% 平仓数量及剩余持仓预览。
- 行情过期、延迟、闭市、映射未验证或深度不足时的禁用状态和原因。
- 表格、标签页、状态更新和键盘操作的无障碍测试。

### 领域计算和数据协议

- 运行时 Schema 拒绝错误合约和时间戳。
- 多档盘口的十进制安全 VWAP。
- 使用正确 Bid/Ask 的汇率换算。
- 资金费率正负号和非 8 小时结算周期。
- 股票整数/交易单位取整、永续步长取整和剩余敞口。
- 全部及部分平仓不变量。
- 成本拆分和预计平仓价差。

### 模拟执行协调器

- 两边按任意顺序确认和成交。
- 一边拒单发生在另一边成交前或成交后。
- 任意一边或两边部分成交。
- 提交结果不明确，之后通过远端对账恢复。
- 撤单失败、有界修复和人工干预。
- 重复客户端请求和进程重启幂等性。
- 永续平仓及降低空头风险的修复订单始终使用 Reduce-only。

### 集成和端到端

- fixture 只读页面通过真实 Fastify 和前端 API Schema 工作。
- WebSocket 重连后，旧快照不能覆盖新状态。
- SQLite 能在重启后恢复模拟的非终态批次。
- 只读模式下不存在任何订单网络调用路径。

## 14. 交付顺序和阶段门槛

1. **正式只读页面：** React 组件、共享 Schema、fixture 接口、计算和测试；不连接外部账户。
2. **真实只读行情：** 已验证标的映射、IBKR 行情适配器、永续深度/资金费率适配器、汇率适配器、新鲜度和交易时段检查。
3. **模拟执行：** 持久化模拟持仓和双腿状态机，包括补偿及重启恢复。
4. **真实执行准备评审：** 确认合约身份、权限、换算比例、汇率风险、费用、税费/ADR 成本、Gateway 运维方案和风险限制。
5. **真实执行：** 增加执行适配器；只有用户明确授权并通过准备评审后才启用按钮。

每个阶段必须通过相应测试和运行评审后，才能进入下一阶段。本设计之后的首份实施计划只覆盖第 1 阶段；后续阶段在前置条件验证完成后分别制定实施计划。
