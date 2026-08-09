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

## 15. 后端模块详细设计

第 8～14 节描述总体边界，本节起定义最终形态的实现协议。第一阶段只启用其中的 fixture 行情、计算和只读接口；未启用的模块仍按本设计保留边界，避免后续重构核心数据结构。

```text
CarryMappingService
  解析、验证、版本化管理股票与永续映射

CarryQuoteCoordinator
  合并 IBKR 盘口、永续盘口、资金费率和 FX 行情
  生成带 sequence 和 snapshotId 的一致行情集

CarryPricingEngine
  计算两边 VWAP、换算数量、成本、资金费和预计净收益
  纯计算，不访问数据库和网络

CarryPreviewService
  生成开仓/平仓预览
  持久化真实执行所引用的不可变定价快照

CarryPositionRepository
  管理本策略持仓和乐观锁版本

CarryExecutionRepository
  原子写入执行批次、订单腿、成交、资金费和事件

CarryExecutionCoordinator
  并发提交两腿、处理回报、撤单、补偿和人工干预

CarryRecoveryService
  启动恢复、未知订单对账、远端成交补录和敞口复核

CarryStreamPublisher
  向现有终端 WebSocket 发布机会、持仓和执行更新
```

模块依赖方向固定为：HTTP/WS 层 → Service/Coordinator → Repository/Adapter。Repository 不能调用 Adapter；Adapter 不能直接更新数据库；所有远端回报先进入 Coordinator，再由 Coordinator 通过事务写账本。

## 16. 数据库详细设计

### 16.1 迁移规则

- 使用下一个不可变迁移文件 `migrations/0018_sk_hynix_carry.sql`。
- 迁移纳入现有 SHA-256 校验机制，应用后不得修改。
- 所有表继续使用 SQLite、外键、WAL 和同步 `better-sqlite3` 事务。
- 金额、价格、费率和数量使用规范化十进制字符串；时间使用 ISO 8601 UTC 字符串。
- JSON 字段只保存不可变快照、第三方原始元数据或可扩展明细；需要查询和约束的字段必须独立成列。
- 不持久化连续高频盘口。只有用户预览、模拟执行或真实执行引用的定价快照入库。
- 实际迁移创建顺序为映射 → 持仓 → 定价快照 → 批次 → 订单腿 → 成交/资金费/事件，保证所有父表先于子表存在；本节按概念阅读顺序说明各表。

### 16.2 `carry_instrument_mappings`

保存经过版本化的经济标的映射。已被持仓或执行批次引用的版本不可原地修改；变更时创建新版本，并将旧版本转为 `SUSPENDED`。

```sql
CREATE TABLE carry_instrument_mappings (
  id TEXT PRIMARY KEY,
  mapping_group_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UNVERIFIED', 'VERIFIED', 'SUSPENDED')),
  economic_underlying_id TEXT NOT NULL,

  ibkr_con_id INTEGER NOT NULL,
  ibkr_symbol TEXT NOT NULL,
  ibkr_local_symbol TEXT NOT NULL,
  ibkr_sec_type TEXT NOT NULL,
  ibkr_exchange TEXT NOT NULL,
  ibkr_primary_exchange TEXT,
  ibkr_currency TEXT NOT NULL,
  ibkr_timezone TEXT NOT NULL,
  ibkr_trading_hours_json TEXT NOT NULL,
  ibkr_lot_size TEXT NOT NULL,

  perp_venue TEXT NOT NULL,
  perp_symbol TEXT NOT NULL,
  perp_base TEXT NOT NULL,
  perp_quote TEXT NOT NULL,
  perp_settlement_currency TEXT NOT NULL,
  perp_contract_multiplier TEXT NOT NULL,
  perp_quantity_step TEXT NOT NULL,
  perp_minimum_quantity TEXT NOT NULL,

  equity_units_per_perp_unit TEXT NOT NULL,
  verification_source TEXT NOT NULL,
  verification_payload_json TEXT NOT NULL,
  verified_at TEXT,
  suspended_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (mapping_group_id, version)
);

CREATE INDEX carry_mapping_status_idx
  ON carry_instrument_mappings(status, updated_at DESC);
CREATE INDEX carry_mapping_ibkr_idx
  ON carry_instrument_mappings(ibkr_con_id, status);
CREATE INDEX carry_mapping_perp_idx
  ON carry_instrument_mappings(perp_venue, perp_symbol, status);
CREATE UNIQUE INDEX carry_mapping_one_verified_idx
  ON carry_instrument_mappings(mapping_group_id)
  WHERE status = 'VERIFIED';
```

同一 `mapping_group_id` 最多只能有一个可用于新开仓的 `VERIFIED` 版本，由唯一索引兜底，并由 Repository 在一个事务内完成旧版本停用和新版本启用。数据库允许历史持仓继续引用已停用版本，但该版本不能再用于新开仓。

### 16.3 `carry_pricing_snapshots`

保存执行决策所依据的完整不可变输入和计算输出。普通排行刷新只存在内存；只有显式预览和执行预检才创建记录。

```sql
CREATE TABLE carry_pricing_snapshots (
  id TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL REFERENCES carry_instrument_mappings(id),
  source TEXT NOT NULL CHECK (source IN ('FIXTURE', 'SIMULATION', 'LIVE')),
  purpose TEXT NOT NULL CHECK (purpose IN ('OPEN', 'CLOSE', 'REPAIR')),
  position_id TEXT REFERENCES carry_positions(id),
  report_currency TEXT NOT NULL,
  requested_notional TEXT,
  requested_close_fraction TEXT,
  requested_equity_quantity TEXT,
  horizon_seconds INTEGER NOT NULL,
  quote_set_json TEXT NOT NULL,
  normalized_input_json TEXT NOT NULL,
  calculation_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  ineligibility_reasons_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX carry_pricing_mapping_captured_idx
  ON carry_pricing_snapshots(mapping_id, captured_at DESC);
CREATE INDEX carry_pricing_expiry_idx
  ON carry_pricing_snapshots(expires_at);
```

`quote_set_json` 包含两边完整使用深度、FX 路径、资金费率、行情类型和各自时间戳；`calculation_json` 包含 VWAP、数量、成本拆分、残余敞口和收益假设。`content_hash` 对规范化后的输入与输出计算 SHA-256，用于审计和幂等检查。

### 16.4 `carry_positions`

持仓是策略所有权边界，只记录本策略成交形成的数量，不直接复制账户总持仓。

```sql
CREATE TABLE carry_positions (
  id TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL REFERENCES carry_instrument_mappings(id),
  environment TEXT NOT NULL CHECK (environment IN ('SIMULATION', 'LIVE')),
  state TEXT NOT NULL CHECK (state IN (
    'OPENING', 'OPEN', 'PARTIALLY_CLOSED', 'CLOSING', 'CLOSED', 'MANUAL_INTERVENTION'
  )),
  report_currency TEXT NOT NULL,
  opened_equity_quantity TEXT NOT NULL DEFAULT '0',
  opened_perp_quantity TEXT NOT NULL DEFAULT '0',
  remaining_equity_quantity TEXT NOT NULL DEFAULT '0',
  remaining_perp_quantity TEXT NOT NULL DEFAULT '0',
  equity_average_entry_price TEXT,
  perp_average_entry_price TEXT,
  realized_price_pnl TEXT NOT NULL DEFAULT '0',
  funding_cashflow TEXT NOT NULL DEFAULT '0',
  commissions_and_fees TEXT NOT NULL DEFAULT '0',
  residual_economic_exposure TEXT NOT NULL DEFAULT '0',
  residual_fx_exposure TEXT NOT NULL DEFAULT '0',
  row_version INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX carry_positions_state_idx
  ON carry_positions(environment, state, updated_at DESC);
CREATE INDEX carry_positions_mapping_idx
  ON carry_positions(mapping_id, created_at DESC);
```

每次成交、资金费或修复更新都递增 `row_version`。平仓预览记录该版本；提交时版本不一致则返回 `carry_position_changed`，要求重新预览。

### 16.5 `carry_execution_batches`

一个批次表示一次用户开仓、平仓或系统补偿决策，并关联同一个权威定价快照。

```sql
CREATE TABLE carry_execution_batches (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES carry_positions(id),
  mapping_id TEXT NOT NULL REFERENCES carry_instrument_mappings(id),
  pricing_snapshot_id TEXT NOT NULL REFERENCES carry_pricing_snapshots(id),
  environment TEXT NOT NULL CHECK (environment IN ('SIMULATION', 'LIVE')),
  operation TEXT NOT NULL CHECK (operation IN ('OPEN', 'CLOSE', 'REPAIR')),
  status TEXT NOT NULL CHECK (status IN (
    'submitting', 'acknowledged', 'partially_filled', 'filled', 'failed',
    'compensating', 'manual_intervention', 'cancelled'
  )),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_position_version INTEGER NOT NULL,
  previous_position_state TEXT NOT NULL,
  max_slippage_bps TEXT NOT NULL,
  compensation_attempts INTEGER NOT NULL DEFAULT 0,
  compensation_deadline_at TEXT,
  failure_code TEXT,
  failure_detail_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_at TEXT,
  UNIQUE (environment, idempotency_key)
);

CREATE INDEX carry_batches_status_idx
  ON carry_execution_batches(environment, status, updated_at);
CREATE INDEX carry_batches_position_idx
  ON carry_execution_batches(position_id, created_at DESC);
CREATE UNIQUE INDEX carry_batches_one_active_position_idx
  ON carry_execution_batches(position_id)
  WHERE status IN (
    'submitting', 'acknowledged', 'partially_filled', 'compensating', 'manual_intervention'
  );
```

相同环境和幂等键配合同一 `request_hash` 时返回原批次；幂等键相同但请求内容不同则返回 `carry_idempotency_conflict`。

### 16.6 `carry_execution_legs`

每次批次至少有 `EQUITY` 和 `PERP` 两条主订单腿；补偿订单通过递增 `attempt` 添加新记录，不能覆盖原订单。

```sql
CREATE TABLE carry_execution_legs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES carry_execution_batches(id),
  pricing_snapshot_id TEXT NOT NULL REFERENCES carry_pricing_snapshots(id),
  leg TEXT NOT NULL CHECK (leg IN ('EQUITY', 'PERP')),
  purpose TEXT NOT NULL CHECK (purpose IN ('PRIMARY', 'COMPENSATION')),
  attempt INTEGER NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('IBKR', 'CROSSEX', 'SIMULATION')),
  native_instrument_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL CHECK (order_type IN ('PROTECTED_LIMIT', 'MARKET')),
  time_in_force TEXT NOT NULL,
  requested_quantity TEXT NOT NULL,
  limit_price TEXT,
  reduce_only INTEGER NOT NULL CHECK (reduce_only IN (0, 1)),
  client_order_id TEXT NOT NULL,
  remote_order_id TEXT,
  ibkr_perm_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED', 'FAILED',
    'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN'
  )),
  filled_quantity TEXT NOT NULL DEFAULT '0',
  average_fill_price TEXT,
  failure_code TEXT,
  failure_detail_json TEXT,
  submitted_at TEXT,
  acknowledged_at TEXT,
  terminal_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, leg, purpose, attempt),
  UNIQUE (adapter, client_order_id)
);

CREATE INDEX carry_legs_remote_idx
  ON carry_execution_legs(adapter, remote_order_id)
  WHERE remote_order_id IS NOT NULL;
CREATE INDEX carry_legs_status_idx
  ON carry_execution_legs(status, updated_at);
```

主订单腿引用批次的初始定价快照；每次补偿腿引用当次重新生成的 `REPAIR` 快照。规则：永续 `CLOSE` 腿必须 `reduce_only=1`；IBKR 不支持交易所式 Reduce-only，因此由本地策略持仓上限、远端持仓复核和订单数量共同约束。`MARKET` 只允许经风险策略明确批准的补偿订单，普通开平仓使用带最大滑点的保护限价。

### 16.7 `carry_fills`

```sql
CREATE TABLE carry_fills (
  id TEXT PRIMARY KEY,
  leg_id TEXT NOT NULL REFERENCES carry_execution_legs(id),
  adapter TEXT NOT NULL,
  remote_execution_id TEXT NOT NULL,
  quantity TEXT NOT NULL,
  price TEXT NOT NULL,
  fee TEXT NOT NULL DEFAULT '0',
  fee_currency TEXT,
  report_currency_fee TEXT NOT NULL DEFAULT '0',
  liquidity_role TEXT,
  executed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  UNIQUE (adapter, remote_execution_id)
);

CREATE INDEX carry_fills_leg_idx
  ON carry_fills(leg_id, executed_at);
```

成交按远端 execution ID 去重。插入成交、汇总订单腿、更新策略持仓、更新批次状态和追加事件必须在同一 SQLite 事务内完成。

### 16.8 `carry_funding_cashflows`

```sql
CREATE TABLE carry_funding_cashflows (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES carry_positions(id),
  perp_venue TEXT NOT NULL,
  remote_cashflow_id TEXT NOT NULL,
  funding_rate TEXT NOT NULL,
  position_notional TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  report_currency_amount TEXT NOT NULL,
  settlement_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  UNIQUE (perp_venue, remote_cashflow_id)
);

CREATE INDEX carry_funding_position_idx
  ON carry_funding_cashflows(position_id, settlement_at);
```

资金费以实际交易所现金流水为准；预测资金费只存在定价快照中，不能写入已实现现金流。

### 16.9 `carry_execution_events`

```sql
CREATE TABLE carry_execution_events (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES carry_execution_batches(id),
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT,
  leg_id TEXT REFERENCES carry_execution_legs(id),
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, sequence)
);

CREATE INDEX carry_events_batch_idx
  ON carry_execution_events(batch_id, sequence);
```

该表是面向恢复和用户诊断的追加事件流，不替代现有 `audit_events`。涉及用户授权、真实订单、撤单、自动补偿和人工处理的关键动作，同时写入脱敏后的全局审计事件。

### 16.10 删除和保留策略

- `VERIFIED` 映射及仍被引用的历史版本不删除。
- 未到终态的批次、订单腿、成交、持仓和引用的定价快照永不清理。
- 已关闭真实持仓的成交、资金费和执行事件默认永久保留，供对账和成本核算。
- 未被执行引用的 fixture/simulation 定价快照保留 30 天。
- 已结束模拟持仓及其账本默认保留 365 天，可沿用现有数据库维护任务清理。
- 删除顺序必须遵循外键：事件/资金费/成交 → 订单腿 → 批次 → 定价快照 → 已关闭模拟持仓。

## 17. 事务、并发和幂等

### 17.1 网络调用前事务

真实或模拟提交在任何外部调用前执行一个短事务：

1. 校验定价快照、映射状态、行情有效期和持仓 `row_version`。
2. 检查相同持仓是否已有非终态批次。
3. 新开仓时创建 `OPENING` 持仓；平仓时将持仓转为 `CLOSING`。
4. 写入执行用定价快照、批次、两条 `SUBMITTING` 主订单腿和首个执行事件。
5. 提交事务。

数据库事务中不能包含 TWS 或交易所网络调用。

### 17.2 并发提交

事务提交后，协调器在同一事件循环轮次启动两个 Adapter Promise，并使用 `Promise.allSettled` 收集提交结果。两边各自的确认和成交通过事件回调推进，不等待一边确认后才调用另一边。

### 17.3 回报事务

每个订单或成交回报独立进入串行化的批次队列，并在一个事务内完成：

1. 按远端订单 ID、IBKR permId 或客户端订单 ID 定位订单腿。
2. 去重成交和过期状态事件。
3. 更新订单腿累计成交量和均价。
4. 更新策略持仓及 `row_version`。
5. 根据两条腿实际成交经济敞口派生批次状态。
6. 追加 `carry_execution_events`。
7. 事务提交后发布 WebSocket 更新。

### 17.4 并发所有权

- 数据库部分唯一索引保证同一持仓只能存在一个活动批次。
- 进程内以 `positionId` 建立串行任务队列，避免回调交错计算旧状态。
- 数据库约束是最终保护，内存队列只用于减少冲突。
- 平仓必须携带预览时的 `expectedPositionVersion`，防止用户界面使用旧持仓。

### 17.5 幂等规则

- 客户端每次提交生成至少 128 bit 随机 `Idempotency-Key`。
- 服务端对规范化请求体计算 `request_hash`。
- 相同键、相同哈希：返回已有批次，不再次提交远端订单。
- 相同键、不同哈希：返回 HTTP 409 `carry_idempotency_conflict`。
- Adapter 客户端订单 ID 由批次 ID、腿、用途和 attempt 确定性生成；重启后不能生成新 ID 重试同一提交。
- 远端结果不明确时状态进入 `UNKNOWN`，只能先查询远端，不能直接再次提交。

## 18. REST API 详细设计

### 18.1 通用规则

- 路径统一使用 `/api/sk-hynix-carry` 前缀。
- 所有请求和响应由 `packages/shared-types` 中的 Zod Schema 校验。
- 十进制值使用字符串，时间使用 ISO 8601 UTC。
- 读请求继续使用 `x-gct-read-intent`；模拟和真实执行使用不同的 `x-gct-trading-intent`。
- 写请求继承现有本地 Host/Origin、速率限制和全局交易模式检查。
- 成功响应不增加新的通用 envelope，保持仓库现有直接返回资源对象的风格。
- 错误响应使用 `{ error, label?, issues?, details?, correlationId? }`。
- 接口不得返回 IBKR 账号、交易所账号、API Key、TWS 登录信息或未脱敏原始回报。

### 18.2 能力和连接状态

```http
GET /api/sk-hynix-carry/capabilities
```

响应：

```json
{
  "phase": "READ_ONLY_FIXTURE",
  "liveExecutionEnabled": false,
  "simulationEnabled": false,
  "ibkr": {
    "configured": false,
    "connectionState": "DISABLED",
    "marketDataType": null,
    "lastEventAt": null
  },
  "perp": {
    "connectionState": "FIXTURE",
    "lastEventAt": "2026-08-09T08:00:00.000Z"
  },
  "fx": {
    "connectionState": "FIXTURE",
    "lastEventAt": "2026-08-09T08:00:00.000Z"
  },
  "recovery": {
    "state": "READY",
    "unresolvedBatchCount": 0
  }
}
```

`phase` 枚举：`READ_ONLY_FIXTURE | READ_ONLY_LIVE | SIMULATION | LIVE_DISABLED | LIVE_READY`。前端只能根据服务端能力启用相应功能，不能用本地配置自行推断。

### 18.3 标的映射

```http
GET /api/sk-hynix-carry/mappings?status=VERIFIED
```

返回 `CarryInstrumentMapping[]`。默认返回所有状态，`status` 仅支持单个合法枚举。

后续真实只读阶段增加：

```http
POST /api/sk-hynix-carry/mappings/verify
x-gct-read-intent: verify-carry-mapping
```

请求只携带用户选择的候选标识：

```json
{
  "ibkr": { "conId": 123456789 },
  "perp": { "venue": "OKX", "symbol": "SKHYNIXUSDT" },
  "candidateMappingId": "skh-krx-okx"
}
```

客户端不能提交或覆盖经济换算比例。后端重新查询 IBKR ContractDetails 和交易所合约元数据，并与服务端版本化的候选映射规范比较；候选规范包含预期经济底层和换算比例，但不包含账户凭证。只有官方元数据与候选规范全部一致，并经过业务验证流程记录 `verificationSource` 后，才创建 `VERIFIED` 版本。没有候选规范、元数据不完整或无法证明经济等价时只保存 `UNVERIFIED` 结果，不允许用户仅通过页面勾选绕过。

暂停映射：

```http
POST /api/sk-hynix-carry/mappings/:id/suspend
x-gct-trading-intent: suspend-carry-mapping
```

暂停仅阻止新开仓，不能删除历史持仓映射，也不能阻止已有持仓平仓。

### 18.4 机会查询

采用 POST 是因为查询包含结构化条件，但它仍是只读请求：

```http
POST /api/sk-hynix-carry/opportunities/query
x-gct-read-intent: carry-opportunities
```

请求：

```json
{
  "mappingIds": [],
  "requestedNotional": "1000",
  "reportCurrency": "USDT",
  "horizonSeconds": 86400,
  "maxSlippageBps": "20"
}
```

- `mappingIds=[]` 表示所有可参与排行的映射。
- 最大映射数量 100，`horizonSeconds` 范围为 1 个资金费结算周期至 30 天。
- 第一阶段由 fixture QuoteProvider 提供行情；后续阶段接口不变。

响应：

```json
{
  "sequence": 42,
  "calculatedAt": "2026-08-09T08:00:00.000Z",
  "opportunities": [
    {
      "mappingId": "map-skh-krx-okx-v1",
      "eligible": false,
      "ineligibilityReasons": ["FIXTURE_DATA"],
      "requestedNotional": "1000",
      "equityQuantity": "8",
      "perpQuantity": "8",
      "equityVwap": "124.62",
      "perpVwap": "124.93",
      "openingSpreadBps": "24.87",
      "expectedFundingBps": "55.47",
      "expectedExitBasisBps": "0",
      "estimatedCostsBps": "23",
      "expectedNetReturnBps": "57.34",
      "expectedNetReturnAmount": "5.73",
      "residualEconomicExposure": "2.48",
      "residualFxExposure": "996.96",
      "funding": {
        "rate": "0.001849",
        "intervalSeconds": 28800,
        "nextFundingAt": "2026-08-09T10:00:00.000Z",
        "predictionSource": "FIXTURE_CURRENT_RATE"
      },
      "quoteTimestamps": {
        "ibkr": "2026-08-09T07:59:59.920Z",
        "perp": "2026-08-09T07:59:59.940Z",
        "fx": "2026-08-09T07:59:59.950Z"
      },
      "assumptions": ["示例数据", "预计平仓价差为 0 bps"]
    }
  ]
}
```

fixture 返回的 `eligible` 必须为 `false`，避免示例数据通过正式执行预检。

### 18.5 创建权威预览

```http
POST /api/sk-hynix-carry/previews
x-gct-read-intent: carry-preview
```

开仓请求：

```json
{
  "mode": "OPEN",
  "mappingId": "map-skh-krx-okx-v1",
  "requestedNotional": "1000",
  "reportCurrency": "USDT",
  "horizonSeconds": 86400,
  "maxSlippageBps": "20"
}
```

平仓请求：

```json
{
  "mode": "CLOSE",
  "positionId": "carry-pos-01",
  "closeFraction": "0.5",
  "expectedPositionVersion": 7,
  "maxSlippageBps": "20"
}
```

也允许以 `equityQuantity` 代替 `closeFraction` 精确指定整数股；二者互斥。服务端基于实际剩余成交比例计算永续平仓量，客户端不能直接指定永续数量。

响应核心字段：

```json
{
  "previewId": "preview-uuid",
  "mode": "CLOSE",
  "mappingId": "map-skh-krx-okx-v1",
  "positionId": "carry-pos-01",
  "positionVersion": 7,
  "expiresAt": "2026-08-09T08:00:02.000Z",
  "eligible": true,
  "ineligibilityReasons": [],
  "orders": {
    "equity": { "side": "SELL", "quantity": "4", "vwap": "124.48" },
    "perp": { "side": "BUY", "quantity": "4", "vwap": "125.08", "reduceOnly": true }
  },
  "remaining": {
    "equityQuantity": "4",
    "perpQuantity": "4",
    "netEconomicExposure": "0.10"
  },
  "costBreakdown": {},
  "assumptions": []
}
```

fixture 预览可展示但始终不可提交。真实行情预览默认有效期 2 秒；具体 TTL 为服务端配置，并通过 `expiresAt` 返回。

### 18.6 持仓查询

```http
GET /api/sk-hynix-carry/positions?environment=LIVE&state=OPEN
GET /api/sk-hynix-carry/positions/:id
GET /api/sk-hynix-carry/positions/:id/fills?cursor=...&limit=50
GET /api/sk-hynix-carry/positions/:id/funding?cursor=...&limit=50
```

列表默认按 `updatedAt DESC`，使用 `cursor` 和 `limit` 分页，`limit` 最大 100。详情包含策略账本数量、账户远端对账数量、偏差、累计资金费、费用、关联活动批次以及 `rowVersion`。成交和资金费接口按事件时间与 ID 组成稳定 cursor，避免新增记录导致翻页重复。

账户远端持仓与策略账本不一致时，返回：

```json
{
  "reconciliation": {
    "state": "MISMATCH",
    "ledgerEquityQuantity": "8",
    "remoteEquityQuantity": "7",
    "ledgerPerpQuantity": "8",
    "remotePerpQuantity": "8",
    "openingEligible": false,
    "closingEligible": false
  }
}
```

不允许把账户同标的总持仓直接归属给本策略。

### 18.7 模拟执行

阶段 3 启用：

```http
POST /api/sk-hynix-carry/simulations/executions
x-gct-trading-intent: simulate-carry
Idempotency-Key: <random-128-bit-or-more>
```

```json
{
  "previewId": "preview-uuid",
  "expectedPositionVersion": 7
}
```

模拟执行只接受 `source=SIMULATION` 的预览，使用模拟 Adapter 和独立账本，不能调用真实网络执行接口。

### 18.8 真实执行

阶段 5 启用：

```http
POST /api/sk-hynix-carry/executions
x-gct-trading-intent: execute-carry
Idempotency-Key: <random-128-bit-or-more>
```

请求与模拟执行相同。服务端依次执行：

1. 检查编译/配置级 `CARRY_LIVE_EXECUTION_ENABLED`。
2. 检查全局 `tradingSession.liveTradingEnabled`。
3. 检查 IBKR、交易所、FX 和 Recovery 状态均为可执行。
4. 检查预览未过期、映射仍有效、持仓版本未变化。
5. 使用最新行情重新定价；如果相对预览超过最大滑点则拒绝。
6. 将最新行情保存为新的执行定价快照。
7. 按第 17.1 节事务创建批次和订单腿。
8. 事务提交后并发调用两边 Adapter。

接口在批次持久化完成后立即返回 HTTP 202：

```json
{
  "executionId": "carry-exec-uuid",
  "positionId": "carry-pos-01",
  "status": "submitting",
  "createdAt": "2026-08-09T08:00:00.000Z"
}
```

HTTP 超时不能代表提交失败。客户端使用相同幂等键重试，或按 execution ID 查询。

### 18.9 执行查询与控制

```http
GET /api/sk-hynix-carry/executions/:id
GET /api/sk-hynix-carry/executions/:id/events?afterSequence=0

POST /api/sk-hynix-carry/executions/:id/cancel
x-gct-trading-intent: cancel-carry-execution

POST /api/sk-hynix-carry/executions/:id/reconcile
x-gct-trading-intent: reconcile-carry-execution
```

- `cancel` 只撤销未成交剩余订单，不能回滚已成交数量。
- `reconcile` 查询远端状态并补录已存在的订单和成交，不能创建新敞口。
- 自动补偿是否继续由批次授权窗口和风险配置决定，不能通过普通 reconcile 请求绕过。

### 18.10 错误码

| HTTP | error | 含义 |
|---|---|---|
| 400 | `invalid_carry_request` | Schema 或字段组合错误 |
| 403 | `missing_read_intent` / `missing_trading_intent` | 缺少意图请求头 |
| 403 | `live_trading_locked` | 当前会话未授权真实交易 |
| 403 | `carry_live_execution_disabled` | 功能尚未启用真实执行 |
| 404 | `carry_mapping_not_found` | 映射不存在 |
| 404 | `carry_position_not_found` | 策略持仓不存在 |
| 404 | `carry_execution_not_found` | 执行批次不存在 |
| 409 | `carry_mapping_unverified` | 映射不可用于该操作 |
| 409 | `carry_preview_expired` | 预览已过期 |
| 409 | `carry_position_changed` | 持仓版本或数量已变化 |
| 409 | `carry_execution_in_progress` | 同一持仓已有活动批次 |
| 409 | `carry_idempotency_conflict` | 幂等键对应不同请求 |
| 409 | `carry_reconciliation_required` | 远端与账本未对齐 |
| 422 | `carry_quote_ineligible` | 行情存在但不满足交易规则 |
| 422 | `carry_insufficient_depth` | 最大滑点内深度不足 |
| 429 | `rate_limit_exceeded` | 本地或上游限频 |
| 502 | `carry_upstream_rejected` | 上游明确拒绝请求 |
| 503 | `carry_ibkr_unavailable` | TWS/Gateway 不可用 |
| 503 | `carry_perp_unavailable` | 永续行情或执行不可用 |
| 503 | `carry_fx_unavailable` | 汇率源不可用 |
| 503 | `carry_recovery_in_progress` | 启动恢复尚未完成 |

涉及上游的错误只返回脱敏 `label`，详细原始信息写入本地日志和执行事件时必须去除凭证、账户号及敏感头。

## 19. WebSocket 协议详细设计

继续复用现有终端 WebSocket，不建立第二条浏览器连接。`TerminalStreamMessageSchema` 增加：

```text
carry.capabilities
carry.opportunity.snapshot
carry.opportunity.update
carry.position.snapshot
carry.position.update
carry.execution.snapshot
carry.execution.update
carry.execution.event
```

公共事件结构：

```json
{
  "type": "carry.execution.update",
  "payload": {
    "sequence": 108,
    "updatedAt": "2026-08-09T08:00:01.000Z",
    "execution": {}
  }
}
```

规则：

- 每类投影维护单调递增 `sequence`；进程内 sequence 重启后可重置，但完整 snapshot 带新的 `streamInstanceId`。
- 客户端按 `streamInstanceId + sequence` 丢弃旧更新。
- 新连接先收到 capabilities、position snapshot 和非终态 execution snapshot。
- 机会订阅按当前页面选择的 mapping IDs 和目标金额建立，离开页面立即释放。
- 机会更新最多每 200 ms 合并发送一次，执行和成交事件不做节流。
- WebSocket 只作为低延迟投影；断线后 REST 快照和数据库账本是恢复依据。
- 消息必须先通过共享 Zod Schema，校验失败时前端忽略该消息并触发 REST 刷新。

浏览器订阅消息扩展为：

```json
{
  "type": "carry.watch",
  "mappingIds": ["map-skh-krx-okx-v1"],
  "requestedNotional": "1000",
  "horizonSeconds": 86400,
  "maxSlippageBps": "20"
}
```

每个连接最多订阅 100 个映射；后端按规范化订阅键共享计算结果，避免每个浏览器订阅重复计算。

## 20. Adapter 接口详细设计

### 20.1 公共状态

所有 Adapter 暴露统一连接状态：

```text
DISABLED | CONNECTING | READY | DEGRADED | RECONNECTING | FAILED
```

状态包含 `lastEventAt`、`lastReadyAt`、`retryAttempt`、脱敏 `lastError` 和能力列表。行情 READY 与交易 READY 分开，存在行情不代表账户或订单通道可用。

### 20.2 IBKR 行情 Adapter

```ts
interface IbkrMarketDataAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): IbkrAdapterStatus;
  resolveContract(conId: number): Promise<IbkrContractDetails>;
  subscribeDepth(
    contract: IbkrResolvedContract,
    listener: (book: IbkrDepthSnapshot) => void,
  ): () => void;
  subscribeMarketState(
    contract: IbkrResolvedContract,
    listener: (state: IbkrMarketState) => void,
  ): () => void;
}
```

要求：

- ContractDetails 必须与映射中的 conId、secType、交易所、主交易所和币种一致。
- 显式记录 TWS `marketDataType`，延迟或冻结行情不能冒充实时行情。
- 盘口序列断裂、断线或 TWS error code 表示订阅失效时，立即使相关机会失去交易资格。
- 订阅按引用计数管理，页面离开且无活动持仓时释放行情。
- 所有请求经过 IBKR pacing 调度器，不能把 Web API 的 10 req/s 当作 TWS pacing 规则。

### 20.3 IBKR 执行 Adapter

```ts
interface IbkrExecutionAdapter {
  status(): IbkrExecutionStatus;
  submit(order: IbkrSubmitIntent): Promise<IbkrSubmitReceipt>;
  cancel(identity: IbkrOrderIdentity): Promise<void>;
  queryOrder(identity: IbkrOrderIdentity): Promise<IbkrOrderSnapshot | null>;
  listExecutions(since: string): Promise<IbkrExecution[]>;
  readPosition(contract: IbkrResolvedContract): Promise<IbkrPosition>;
  onOrder(listener: (event: IbkrOrderEvent) => void): () => void;
  onExecution(listener: (event: IbkrExecution) => void): () => void;
}
```

IBKR 标识处理：

- 本地 `client_order_id` 是应用幂等标识。
- `orderId` 由当前 TWS session 分配，重连后不能单独作为永久标识。
- `permId` 一旦返回立即持久化，用于跨 session 对账。
- `executionId` 用于成交去重。
- 启动时使用 TWS `nextValidId` 与本地已用高水位的较大值生成新 orderId，禁止复用历史 ID。

### 20.4 永续行情 Adapter

```ts
interface PerpMarketDataAdapter {
  resolveInstrument(venue: string, symbol: string): Promise<PerpInstrumentDetails>;
  subscribeDepth(key: PerpInstrumentKey, listener: (book: PerpDepthSnapshot) => void): () => void;
  subscribeFunding(key: PerpInstrumentKey, listener: (funding: PerpFundingSnapshot) => void): () => void;
  status(key?: PerpInstrumentKey): PerpAdapterStatus;
}
```

可复用现有 CrossEx 公共数据连接，但必须输出该策略独立的合约乘数、数量步长、最小数量、资金费周期和下次结算时间。不能继续使用当前通用 `demo_seed` 或固定 8 小时逻辑。

### 20.5 永续执行 Adapter

```ts
interface PerpExecutionAdapter {
  submit(order: PerpSubmitIntent): Promise<PerpSubmitReceipt>;
  cancel(identity: PerpOrderIdentity): Promise<void>;
  queryOrder(identity: PerpOrderIdentity): Promise<PerpOrderSnapshot | null>;
  listFills(since: string): Promise<PerpExecution[]>;
  listFundingCashflows(since: string): Promise<PerpFundingCashflow[]>;
  readPosition(key: PerpInstrumentKey): Promise<PerpPosition>;
  onOrder(listener: (event: PerpOrderEvent) => void): () => void;
  onExecution(listener: (event: PerpExecution) => void): () => void;
}
```

实现可复用 `crossex-client` 的低层认证请求和私有流，但不能把订单交给现有 `TradingRuntime` 管理。Carry Adapter 使用独立客户端订单 ID 前缀并将回报路由给 `CarryExecutionCoordinator`，避免两个运行时同时认领订单。

### 20.6 FX Adapter

```ts
interface FxMarketDataAdapter {
  quotePath(from: string, to: string): Promise<FxExecutablePath>;
  subscribe(pairs: string[], listener: (quote: FxQuote) => void): () => void;
  status(): FxAdapterStatus;
}
```

FX 路径记录每一跳的 Bid/Ask、来源和时间戳。KRW→USD→USDT 的方向必须使用实际可执行侧，不能用中间价掩盖换汇成本。缺少任意一跳时禁止执行。

## 21. TWS / IB Gateway 运行设计

### 21.1 进程边界

- 应用不接管用户 IBKR 密码或双因素认证。
- IB Gateway/TWS 是独立进程，后端通过配置的 host、port 和 clientId 连接。
- 默认只允许 `127.0.0.1`；远程部署只能绑定私网，并由主机防火墙限制来源。
- 只读行情阶段必须启用 Gateway/TWS 的 API Read-Only 设置。
- 真实执行阶段需用户明确关闭 Read-Only，并同时启用应用的 `CARRY_LIVE_EXECUTION_ENABLED`；只满足一项仍不能交易。

### 21.2 会话管理

Adapter 负责：

- 指数退避重连并加入随机抖动；
- 识别每日重启、会话失效、重复 clientId 和连接恢复；
- 重连后重新查询 ContractDetails、行情类型、未完成订单、executions 和持仓；
- 对账完成前保持 `DEGRADED`，禁止新执行；
- 将订阅恢复与订单恢复分开，不能因为行情恢复就认为订单状态已恢复。

是否使用 IBC 只影响 Gateway 进程运维，不进入交易领域接口。采用前必须单独验证当前 IBKR 登录和再认证规则。

### 21.3 Pacing 和请求调度

- 合约详情、历史数据、盘口订阅、订单和账户查询使用分类队列。
- Adapter 根据 TWS 错误码对请求做限频和退避，不使用固定 Web API 限额。
- 订单提交不因普通行情查询积压；但不能绕过 IBKR 订单相关限制。
- pacing 拒绝属于明确失败还是结果未知，必须按对应 TWS 回报分类，不能统一自动重试。

### 21.4 时间和交易时段

- 保存 IBKR 合约时区和标准/扩展交易时段。
- 第一版真实交易只允许股票常规交易时段。
- 以后如开放盘前盘后，必须建立独立风险策略和用户开关，不能仅依赖 `outsideRth=true`。
- 后端监控本机时间偏差；时间偏差超过配置阈值时禁止执行。

## 22. 状态转移和执行协调

### 22.1 订单腿状态转移

允许的主要转移：

```text
SUBMITTING -> ACKNOWLEDGED | PARTIALLY_FILLED | FILLED | FAILED | UNKNOWN
ACKNOWLEDGED -> PARTIALLY_FILLED | FILLED | CANCEL_PENDING | FAILED | UNKNOWN
PARTIALLY_FILLED -> FILLED | CANCEL_PENDING | CANCELLED | UNKNOWN
CANCEL_PENDING -> CANCELLED | PARTIALLY_FILLED | FILLED | UNKNOWN
UNKNOWN -> ACKNOWLEDGED | PARTIALLY_FILLED | FILLED | FAILED | CANCELLED
```

终态回报不能被较旧事件回退。相同远端时间戳时，以累计成交量更大的事件优先；不能比较的事件保留到执行事件表并触发对账。

### 22.2 批次状态派生

- 任一腿仍在提交且无成交：`submitting`。
- 两腿均确认且无成交：`acknowledged`。
- 任一腿部分/全部成交但经济敞口尚未平衡：`partially_filled`。
- 两腿目标均完成且残余敞口在阈值内：`filled`。
- 两腿均明确失败且无成交，或已安全撤销且无成交：`failed`/`cancelled`。
- 已产生失衡且正在撤单或下修复单：`compensating`。
- 结果未知、超过补偿预算或无法证明安全：`manual_intervention`。

`filled` 判断依据是归一化经济敞口和策略目标，不是简单判断两个远端订单均显示 FILLED。

### 22.3 持仓状态

```text
OPENING -> OPEN | CLOSED | MANUAL_INTERVENTION
OPEN -> CLOSING
CLOSING -> OPEN | PARTIALLY_CLOSED | CLOSED | MANUAL_INTERVENTION
PARTIALLY_CLOSED -> CLOSING | MANUAL_INTERVENTION
MANUAL_INTERVENTION -> OPEN | PARTIALLY_CLOSED | CLOSED
```

开仓两腿均明确失败且没有成交时，零持仓记录转为 `CLOSED`；平仓两腿均明确失败且没有新成交时，持仓恢复为批次记录的 `previous_position_state`。人工干预后的状态恢复必须先完成远端对账并写审计事件，不能由前端直接修改数据库状态。

### 22.4 补偿算法

1. 汇总两条腿所有 PRIMARY 和 COMPENSATION 成交。
2. 按映射乘数、成交价和执行时 FX 计算实际经济敞口。
3. 先撤销可能继续扩大失衡的未成交订单。
4. 在最新可执行深度下比较两种风险降低路径：补足落后腿，或反向减少领先腿。
5. 选择预计执行后绝对净敞口更小且不违反 Reduce-only/持仓上限的路径。
6. 修复数量受剩余持仓、深度、最大滑点、最大修复名义金额和尝试次数限制。
7. 每次修复重新创建 `REPAIR` 定价快照和 COMPENSATION 订单腿。

默认上限在进入真实执行评审前确定并写入 `risk_rules`。代码硬上限：最多 3 次自动补偿、总窗口不超过 30 秒；部署配置只能收紧，不能放宽代码硬上限。

## 23. 启动恢复和对账

### 23.1 Recovery 状态

```text
STARTING -> RECONCILING -> READY | BLOCKED
```

只要存在无法解析的真实批次，Recovery 为 `BLOCKED`，禁止新开仓和平仓。用户仍可查看状态和发起显式 reconcile。

### 23.2 启动流程

1. 打开数据库并完成完整性与迁移校验。
2. 载入所有非终态批次、订单腿、持仓和映射版本。
3. 连接 IBKR 和交易所只读查询通道。
4. 按 clientOrderId、remoteOrderId、permId 查询每条腿。
5. 拉取缺失成交和资金费，按远端唯一 ID 去重补录。
6. 比较策略账本与远端账户持仓。
7. 对仍可能成交的遗留订单发起撤单。
8. 所有状态明确且账本可解释时进入 `READY`，否则进入 `BLOCKED` 并标记人工干预。

### 23.3 重启后的权限边界

- 每次进程启动后全局真实交易仍为锁定状态。
- 启动恢复可以查询状态、补录成交和撤销遗留订单，因为这些操作不创建新敞口。
- 重启后不能自动提交新的补偿订单；发现裸露风险时进入 `manual_intervention`，等待用户重新启用真实交易并明确处理。
- 只有原交易会话仍授权、原批次补偿窗口尚未到期且远端结果已明确时，运行中的协调器才可自动补偿。

### 23.4 外部手工交易

如果用户在 IBKR 或交易所手工改变同标的持仓：

- 策略账本不吸收该交易。
- 对账投影显示账户持仓与策略持仓差异。
- 差异影响安全平仓时禁止自动操作并进入人工干预。
- 用户必须先在外部恢复数量，或通过以后单独设计的“账本调整”流程处理；本设计不允许直接把外部仓位认领为策略仓位。

## 24. 风险策略

复用现有 `risk_rules` 表保存可配置阈值，scope 使用 `strategy`，metric 使用以下固定名称：

```text
carry.max_open_notional
carry.max_total_notional
carry.max_residual_notional
carry.max_residual_bps
carry.max_slippage_bps
carry.max_ibkr_quote_age_ms
carry.max_perp_quote_age_ms
carry.max_fx_quote_age_ms
carry.max_cross_source_skew_ms
carry.max_compensation_notional
```

规则：

- 缺少任一真实执行必需规则时 fail closed。
- 实际使用的规则值写入定价快照，保证事后可解释。
- 第一阶段 fixture 可以使用显式示例值，但 `eligible=false`。
- 真实执行硬限制不得仅依赖数据库配置；代码保留最大滑点、最大补偿次数和补偿时间的不可放宽上限。
- 持仓总名义金额使用股票和永续归一化后的较大值，不能用净额抵消后规避限制。

## 25. 安全、凭证和审计

### 25.1 凭证

- 交易所凭证继续存放在 OS keychain 或受保护的本地 `.env`，不进入 SQLite。
- 应用不存储 IBKR 用户名、密码或双因素认证信息。
- SQLite 只保存脱敏连接元数据和 Adapter 状态，不保存账户号原文。
- 日志和 `raw_payload_json` 写入前统一过滤 API Key、Authorization、Cookie、账户号和 TWS 敏感字段。

### 25.2 本地访问保护

沿用现有：

- Host 白名单和同源 Origin 检查；
- Helmet/CSP；
- 本地写接口速率限制；
- `x-gct-read-intent` / `x-gct-trading-intent`；
- 每次启动恢复为交易锁定；
- 用户明确接受风险说明后才能启用真实交易。

Carry 真实下单还需同时满足功能级 feature flag、Recovery READY、两边 Adapter 交易能力 READY 和映射 VERIFIED。

### 25.3 审计事件

至少记录：

```text
carry_mapping_verified
carry_mapping_suspended
carry_preview_created（仅记录可用于模拟或真实执行的持久化预览，不记录排行刷新）
carry_simulation_submitted
carry_live_execution_submitted
carry_execution_cancel_requested
carry_compensation_started
carry_manual_intervention_required
carry_reconciliation_completed
carry_position_closed
```

审计 payload 包含 correlationId、资源 ID、状态和规范化数量，不包含凭证和完整上游报文。

## 26. 可观测性和运维

- `/api/health` 增加 Carry 汇总：phase、mapping 数、Adapter 状态、Recovery 状态和未解决批次数量；不泄露合约账户信息。
- 结构化日志统一携带 `correlationId`、`batchId`、`positionId`、`legId`，禁止只记录自然语言。
- 对行情过期、盘口断流、pacing、重连、未知订单、补偿和人工干预使用明确事件名。
- SQLite 备份继续使用现有备份脚本；恢复备份后首次启动必须进行全量远端对账。
- 正常退出先停止新预览和新执行，再取消本进程追踪的活动订单、等待有界回报、落库最终状态，最后关闭 Adapter 和数据库。
- Gateway 每日重启窗口内禁止新开仓；已有持仓只保持监控，连接恢复并完成对账后才能恢复操作。

## 27. 完整测试和验收矩阵

### 27.1 数据库

- 从空库执行 `0018`，以及从当前生产迁移链升级。
- 外键、状态 CHECK、幂等唯一索引和单持仓活动批次索引。
- 定价快照不可变性和 content hash。
- 重复成交、重复资金费、乱序事件去重。
- 成交事务失败时订单腿、持仓、事件全部回滚。
- 数据维护不删除活动或真实账本记录。

### 27.2 API Schema 和权限

- 每个请求/响应通过共享 Zod Schema。
- 小数不得以 JS number 穿过 API 边界。
- 缺少 intent、交易锁定、feature flag 关闭和 Recovery BLOCKED 均 fail closed。
- fixture 机会和预览永远不能提交到模拟或真实 Adapter。
- 相同幂等键同请求返回原批次，不同请求返回 409。
- 预览过期、映射版本变化、持仓 rowVersion 变化和行情滑点变化。

### 27.3 定价

- 股票 Ask/永续 Bid 开仓和股票 Bid/永续 Ask 平仓。
- 多档 VWAP、深度不足、最大滑点边界。
- KRW/USD/USDT 多跳汇率的正确 Bid/Ask 方向。
- 合约乘数、非 1:1 映射、股票交易单位和永续步长。
- 正/负资金费及 1、4、8 小时等不同周期。
- 预计平仓价差、手续费、佣金、税费、融资和取整残差。

### 27.4 Adapter 合约测试

- TWS 合约不匹配、延迟行情、断线、重复 clientId、nextValidId 恢复。
- TWS orderId、permId、executionId 的关联和去重。
- CrossEx 订单 ID 路由不能被现有 TradingRuntime 误认领。
- 明确拒绝与提交结果未知的区分。
- pacing 队列不会饿死订单请求，也不会无界重试。

### 27.5 状态机和补偿

- 两条腿按所有确认/成交顺序组合推进。
- 一边明确拒绝、另一边无成交；一边拒绝、另一边部分或全部成交。
- 双边不同程度部分成交、多次成交和成交后撤单。
- UNKNOWN 经查询恢复为各种终态。
- 补足落后腿和减少领先腿两种路径。
- 达到 3 次或 30 秒硬限制后进入人工干预。
- 所有平仓永续订单 Reduce-only，且不超过策略持仓。

### 27.6 恢复

- 在事务提交后、第一条远端调用前崩溃。
- 一条腿提交成功、另一条腿调用前崩溃。
- 两边已接受但本地未收到回报时崩溃。
- 成交写入一半时事务回滚。
- Gateway 和交易所分别断线、同时断线及重连乱序。
- 重启锁定状态只允许查询、补录和撤单，不自动发补偿单。
- 外部手工持仓变化导致对账不一致。

### 27.7 前端和 E2E

- 正式路由、刷新恢复、懒加载和导航可访问性。
- 排行选择、开平仓切换、部分平仓和剩余敞口联动。
- 每一个 ineligibility reason 都有明确展示。
- WebSocket 断线后 REST 恢复，旧 sequence 不覆盖新投影。
- 一次点击只产生一个幂等请求；按钮提交后立即防重复点击。
- 双腿状态轨道准确显示 UNKNOWN、补偿和人工干预。
- 只读阶段通过网络拦截证明没有真实订单请求。

## 28. 最终交付分解

总体设计覆盖最终真实执行，但按以下独立实施计划交付：

1. **只读页面与 fixture：** 路由、React 组件、共享 Schema、纯计算引擎、fixture API 和前端/E2E 测试。
2. **数据库基础：** `0018`、Repository、不可变预览快照、模拟账本和事务测试。
3. **真实只读行情：** 映射验证、IBKR/永续/FX 行情 Adapter、机会流和交易资格。
4. **模拟协调器：** 双腿状态机、幂等、补偿、恢复和模拟 E2E。
5. **真实执行准备：** TWS 库兼容性验证、Gateway 运维、安全与风险参数验收。
6. **真实执行：** 两边执行 Adapter、资金费对账、实盘恢复和受控启用。

第 1 份实施计划只覆盖第 1 项，但后续实现不得偏离本设计中的数据库、API、事件和恢复协议。任何真实合约代码、换算比例、费用或交易时段规则必须在第 3/5 阶段用真实账户权限和官方合约元数据验证后，作为版本化映射或风险配置落地，不能直接抄用 Demo 示例值。
