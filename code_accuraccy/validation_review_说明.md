# `validation_review.js` 说明文档

> 对应版本：2026-09-29（含【改动34】Sentinel-1 预/后向散射约束 + 五层分层抽样）
> 同目录相关文件：`validation_points.js`（第一阶段，导出样本点 CSV）、`validation_accuracy_report.py`（本地指标计算）、`阈值合理性与精度评价流程.md`（整体链路与原则）

---

## 1. 这个文件做什么

`validation_review.js` 是**伪标签精度评价的第二阶段**——「目视判读工作台」，在 Google Earth Engine Code Editor 里运行。它做四件事：

1. 复用第一部分的标签生成代码，为每个事件算出证据图层；
2. 生成一批**待判读点**（本版本按五层分层抽样）；
3. 提供面板，让你逐点看遥感证据、盲判 Flood / Non-Flood / Uncertain，并记录 `confidence`；
4. 把判读结果导出成 CSV（`reference`），交给 `validation_accuracy_report.py` 算精度指标。

它**不是 Node 脚本**：依赖 `ee.*` / `Map.*` / `ui.*` / `Export.*`，本地只能做语法检查（`node --check`），必须到 Code Editor 里 Run。

---

## 2. 当前版本的整体结构

| 位置 | 内容 | 来源 |
| --- | --- | --- |
| 开头注释 | 与 `validation_points.js` 的 5 处差异 | 【第二阶段】【改动34】 |
| 0 节 | 研究区（`wuhan` 资产） | 复用 |
| 1 节 | 全局参数：判识阈值、抽样参数、窗口参数、去偏/云掩膜/诊断开关 | 复用 + 【改动34】4 个新阈值 |
| 2 节 | 事件表 `EVENTS`（20 条 = 18 场暴雨 + 2 场对照）、`RUN_EVENT_NAMES`、`VALIDATION_EVENT_NAMES` | 复用 + 【改动34】tune/valid 留出 |
| 3 节 | 时间窗口工具函数（北京时 → UTC、事件前/后窗口推导） | 复用 |
| 4 节 | `buildEvent(ev)`：单场事件的 SAR + 光学标签与证据（4.1–4.16） | 复用 + 【改动34】4.10b |
| 5 节 | 逐时段执行 `RUN_EVENT_NAMES` 过滤 + `EVENTS_TO_RUN.map(buildEvent)` | 复用 |
| 6 节 | 旧的「显示」块（伪标签图层）——**已移除**，避免暴露答案 | 【第二阶段】 |
| 7 节 | 导出开关 `EXPORT_ALL / EXPORT_PER_EVENT / EXPORT_SUMMARY`——**全部关闭** | 【第二阶段】 |
| 第二部分 7.1 | 判读点表：按五层分层抽样 | 【改动34】重写 |
| 第二部分 7.2 | 判读状态与图层管理（证据图层、点图层、高亮） | 【第二阶段】 |
| 第二部分 7.3 | 判读面板与按钮 | 【第二阶段】+【改动34】增补显示 |
| 第二部分 7.3 之后 | 记录 `record()`、撤销、`leanRecords()`、导出 CSV/底表（源码里没有独立小节标题） | 【第二阶段】+【改动34】导出列 |

### `buildEvent` 内部（4 节）分步

| 小节 | 内容 |
| --- | --- |
| 4.1 / 4.2 / 4.3 | S1 前/后时相收集、S2 光学（L2A 优先、可被事件表强制 `s2Source`）、数据可用性检查 |
| 4.4 | SAR 时相合成与变化量：`VV_pre` / `VH_pre` / `vv_post_c` / `vh_post_c`、`vv_diff`、`vh_diff`、`VV_ratio`、`s1Valid`、逐景去偏 |
| 4.5 / 4.5b | 光学证据（逐景算指数后取 `max`）、后窗越界尾段诊断 |
| 4.6 | DEM / 坡度 / JRC 永久水体 |
| 4.7 / 4.9 | 洪涝类（High / Medium Flood）与非洪涝类（High / Medium Non-Flood） |
| 4.8 | SAR 稳定区（相对全 ROI 差值中位数 ± 容差） |
| 4.10 | 最终 `label` 与 `conf_flood` / `conf_nonflood`（含正负冲突保护） |
| **4.10b** | **【改动34】判读分层带 `stratum` + 新旧标签 `new_label` / `old_label` / `old_sar_flood`** |
| 4.11 | 特征栈（波段名与顺序与原 `temp.js` 一致，下游脚本不用改） |
| 4.12 / 4.13 | 逐场像元统计、动态抽样（训练样本用，判读脚本不导出） |
| 4.14 / 4.15 | 汇总行、S2 光学覆盖质控（`s2_cover_valid_frac` / `high_flood_share` / `s2_qc_flag`） |
| 4.16 | 诊断输出（`DIAG = true` 时才跑） |

---

## 3. 【改动34】本次新增内容（重点）

### 3.1 同步 Sentinel-1 预/后向散射约束

新增 4 个阈值（与 `code/pseudo_labels1.js` 逐条一致）：

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `VV_PRE_NONWATER_TH` | −15 dB | 事件前 VV **高于**此值才视为非水 |
| `VH_PRE_NONWATER_TH` | −20 dB | 事件前 VH **高于**此值才视为非水 |
| `VV_POST_WATER_TH` | −16 dB | 事件后 VV **低于**此值才视为水体 |
| `VH_POST_WATER_TH` | −22 dB | 事件后 VH **低于**此值才视为水体 |

`sarFlood` 由 2 项相对变化扩展为 6 项（4.4 节）：

```
vv_diff < -4.0  ∧  vh_diff < -3.5          ← 原规则（相对下降）
∧ vv_pre  > -15 ∧  vh_pre  > -20           ← 新增：事件前必须是陆面
∧ vv_post_c < -16 ∧ vh_post_c < -22        ← 新增：事件后必须到水体量级
再叠加 s1Valid
```

**为什么加**：只要求"相对下降"会把事件前就已经是水的像元（河湖、沟渠、坑塘、泡田、季节性明水、临时积水）算成新增洪水——水面后向散射不是常数，风场（水面粗糙度）、轨道/入射角变化、基线土壤湿度漂移都能让同一个水面再掉几个 dB，差值条件照样成立。脚本里唯一管"已有水"的条件是 JRC 永久水体（`occurrence > 90%`），季节性水体和小水面它挡不住。

**注意**：这 4 个值是 IW GRD 的**参考初值，尚未按本区标定**；标定它们正是这个判读台这一轮的任务。

### 3.2 新增 4.10b：分层带与新旧两套标签

`stratum`（判读抽样与分组统计的依据）：

| 值 | 键名 | 含义 |
| --- | --- | --- |
| 0 | `nonflood` | 非洪涝（新规则未判洪） |
| 1 | `high_flood` | High Flood（判洪 + 光学背书，`conf_flood = 2`） |
| 2 | `medium_flood` | Medium Flood（判洪 + 窗口内无 S2，`conf_flood = 1`） |
| 3 | `cut_prewater` | **版本差异层**：约束前判洪、约束后不判洪，原因是事件前已是水（未过 `pre` 条件） |
| 4 | `cut_postweak` | **版本差异层**：同上，原因是事件前非水、事件后不够暗（未过 `post` 条件） |

差异层按**最终标签**定义（旧规则 `label = 1` 且新规则 `label ≠ 1`），也就是 Summary10 比 Summary11 多出、随后被删掉的那些像元；候选层面被删但本来就不进标签的像元（永久水体、坡度不合格）不在其中，不需要判读。

配套导出三条标签：

| 带名 | 含义 | 取值 |
| --- | --- | --- |
| `new_label` | 新规则标签 | 1 = 洪涝 / 0 = 非洪涝 / −1 = 掩膜未定 |
| `old_label` | 旧规则标签（同口径） | 同上 |
| `old_sar_flood` | 旧 SAR 候选（只看 `vv_diff` / `vh_diff` 两项） | 1 / 0 |

`old_label` 的推导依据：改动34 没有改动非洪涝那套条件（`sarStable` / `s2Valid` / `opticalNonWater` / `nonPermanentWater` / 坡度），所以**非旧洪涝像元在新旧两版的判定完全相同**，于是 `old_label = new_label`，仅在"旧规则判洪"处强制为 1。这样导出的 CSV 直接就能做「前后 2×2」对比，不需要跑第二遍脚本。

### 3.3 判读点改成五层分层抽样（7.1 节重写）

| | 旧写法 | 新写法 |
| --- | --- | --- |
| 点位来源 | `r.samples`（训练样本，按 `label` 抽 0 / 1 两类） | `r.reviewImage`（特征栈 + 分层带 + 新旧标签 + 阈值输入） |
| 分层依据 | 伪标签正负两类 | 五层（见 3.2） |
| 每层点数 | `REVIEW_POINTS_PER_CLASS = 200` | `REVIEW_POINTS_PER_STRATUM`：20 / 20 / 20 / 40 / 40 |
| 能否抽到"被删像元" | **不能**（这类点在新标签下已不是洪涝） | 能，第 3、4 层就是 |

每层点数取 `min(该层上限, 该层实际像元数)`，像元不足自动少抽；某层像元数为 0 时该层不出点。各层像元数在 Console 里以频率直方图打印。

### 3.4 判读面板与导出增补

- 面板证据区新增：**抽样层**、`VV_pre` / `VH_pre`（含非水要求阈值）、`VV_post_c` / `VH_post_c`（含水体要求阈值）——判断"事件前是不是已经是水"必须看这四个数。
- 导出列新增：`split`、`stratum`、`stratum_name`、`new_label`、`old_label`、`old_sar_flood`、`VV_pre`、`VH_pre`、`VV_post_c`、`VH_post_c`。
- 自查模式（`REVIEW_HIDE_PSEUDO = false`）下额外显示分层图层，以及 `split` / 新旧标签 / `conf_*`；盲判模式（默认）一概不显示。

### 3.5 事件按 `tune` / `valid` 留出

`VALIDATION_EVENT_NAMES`（独立验证集，不参与调阈值）：

```
Wuhan_2016_0630  历史极值、大面积
Wuhan_2017_0824  强制 L1C（唯一的非 L2A 源）
Wuhan_2021_0823  多云、低面积
Wuhan_2023_0719  A→B 降级
Wuhan_2025_0607  最新年度
```

其余事件 `split = 'tune'`，用于标定 4 个阈值。**`Wuhan_2020_0705` 故意留在调参集**——第一轮已判读的 401 点（`csvdata/validation_points/Wuhan_validation_reference_20200705.csv`）会用于调参，同一场不能再当独立验证。

**当前默认只跑三场**（`RUN_EVENT_NAMES`）：`2020_0705`、`2021_0823`、`2023_0618`。在这三场里 `split` 自动分成：

| 事件 | `split` | 说明 |
| --- | --- | --- |
| `Wuhan_2020_0705` | `tune` | 大面积，调参主力，可叠加第一轮 401 点 |
| `Wuhan_2023_0618` | `tune` | 雨量大但面积很小，最可疑 |
| `Wuhan_2021_0823` | `valid` | 独立验证——本次只有这一场，结论先当**方向性判断** |

扩跑时把 `RUN_EVENT_NAMES` 改回 `null`（全量 18 场），或写成 `var RUN_EVENT_NAMES = tuneEventNames();`（只跑调参集）；`VALIDATION_EVENT_NAMES` 名单不用改，未参与判读的事件不会出现在判读台里。

---

## 4. 参数总表

### 4.1 判识阈值

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `VV_THRESHOLD` | −4.0 dB | VV 后−前 下降超过此值 |
| `VH_THRESHOLD` | −3.5 dB | VH 后−前 下降超过此值 |
| `VV_PRE_NONWATER_TH` / `VH_PRE_NONWATER_TH` | −15 / −20 dB | 【改动34】事件前非水 |
| `VV_POST_WATER_TH` / `VH_POST_WATER_TH` | −16 / −22 dB | 【改动34】事件后为水 |
| `MNDWI_THRESHOLD` | 0.2 | 光学水体阈值 |
| `SLOPE_LIMIT` | 5° | 低坡度阈值 |
| `STABLE_TOLERANCE` | 1.5 dB | SAR 稳定区容差 |
| `PERMANENT_WATER_TH` | 90 % | JRC occurrence 永久水体阈值 |
| `S2_MAX_CLOUD` | 90 % | S2 整景云量上限 |

### 4.2 窗口、去偏、云掩膜、诊断

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `PRE_WINDOW_DAYS` / `PRE_GAP_DAYS` | 24 / 5 天 | 事件前基线窗口长度、与事件开始的间隔 |
| `S1_POST_PAD_DAYS` / `S2_POST_PAD_DAYS` | 18 / 18 天 | S1「搜索窗口」（合成用最早一景 + 8 天）、S2 后窗 |
| `S2_INDEX_STAT` | `'max'` | 逐景算指数后在时间维取 max |
| `DEBIAS_MODE` | `'perImage'` | 逐景扣各自相对前窗基线的偏移 |
| `S2_CLOUD_MASK` | `'QA60'` | 云掩膜口径（另一档 `'SCL_AND_QA60'`，L1C 自动退回 QA60） |
| `S1_FILL_DB` | −50 | GRD 切片填充值阈值，必须显式掩掉 |
| `LOW_S2_COVER_MIN` / `MIN_HIGH_FLOOD_SHARE` / `NO_OPTICAL_COVER` | 0.5 / 0.3 / 0.05 | S2 覆盖质控三档（`s2_qc_flag`） |
| `DIAG` | `false` | 诊断开关（逐景偏移、阈值敏感性、目视图层） |
| `S2_TAIL_DIAG` | `true` | 相邻暴雨 S2 后窗越界尾段诊断（命中才打印） |

### 4.3 抽样与事件范围

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `SAMPLE_SCALE` | 100 m | 抽样与统计尺度 |
| `SAMPLE_SEED` | 20260927 | 抽样随机种子（三类抽样共用，便于复现） |
| `POINTS_PER_CLASS` | 200 | 训练样本抽样上限（判读脚本不导出样本表，**不影响判读点数**） |
| `RUN_EVENT_NAMES` | 三场（`2020_0705` / `2021_0823` / `2023_0618`） | 本次只跑这三场，判读点上限 3 × 140 = 420；`null` = 全量 18 场，也可用 `tuneEventNames()` 只跑调参集 |
| `VIEW_EVENT_NAME` | `Wuhan_2020_0705` | 第一阶段遗留参数，本脚本只声明、未使用（判读台按 `REVIEW_EVENTS` 渲染事件） |

### 4.4 判读台配置

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `REVIEW_SHOW_EVIDENCE` | `true` | 证据图层总开关 |
| `REVIEW_HIDE_PSEUDO` | `true` | **盲判模式**：不显示伪标签、分层与置信度（文档第十六节要求） |
| `REVIEW_POINT_COLOR` / `REVIEW_CURRENT_COLOR` | yellow / red | 待判点统一色、当前点高亮色 |
| `REVIEW_JUMP_ZOOM` | 15 | 跳到某点时的缩放级别 |
| `REVIEW_AUTO_NEXT` | `true` | 记录后自动跳下一点 |
| `EXPORT_BLANK_SHEET` | `false` | `true` = 另导一份线下判读底表（`reference` / `confidence` 留空） |
| `REVIEW_POINTS_PER_STRATUM` | 20 / 20 / 20 / 40 / 40 | 【改动34】每场每层判读点上限（合计最多 140 点/场） |

### 4.5 导出列（`REVIEW_SELECTORS` + `reference` / `confidence`）

| 列 | 说明 |
| --- | --- |
| `point_id` / `event_id` | `事件名_system:index` / 事件名 |
| `split` | `tune`（调参集）/ `valid`（独立验证集） |
| `stratum` / `stratum_name` | 分层值（0–4）/ 分层键名 |
| `pseudo_label` / `new_label` | 新规则标签（`pseudo_label` 为兼容旧脚本的别名） |
| `old_label` / `old_sar_flood` | 旧规则标签 / 旧 SAR 候选 |
| `longitude` / `latitude` | 点位坐标 |
| `conf_flood` / `conf_nonflood` | 伪标签置信档（2 = High，1 = Medium，0 = 无） |
| `VV_pre` / `VH_pre` / `VV_post_c` / `VH_post_c` | 4 个新阈值的直接输入 |
| `VV` / `VH` / `VV_diff` / `VH_diff` / `VV_ratio` | 事件后合成、变化量与比值 |
| `NDVI` / `MNDWI` / `DEM` / `slope` / `S2_Valid` | 光学与地形特征 |
| `reference` / `confidence` | 人工判读真值（1 / 0 / −1）与判读可信度（2 / 1 / 0） |

导出文件名（`description`）：判读结果 `Wuhan_validation_reference`；线下底表 `Wuhan_validation_review_sheet`。

---

## 5. 怎么用（GEE Code Editor）

1. **Run**。Console 会打印：每场的判读分层像元数、「判读事件与候选点数」、「按事件留出：valid = … tune = …」。
2. 面板左上角选事件；用「上一页 / 下一页 / 跳转」移动点位，当前点会以红圈高亮到 15 级。
3. 对着证据判读：
   - `S1 Pre VV` / `S1 Post VV`、`VV_diff`、`VH_diff`：看事件前后是否是水；
   - `S2 RGB` / `MNDWI` / `NDVI`：看光学是否有淹没证据（注意残云）；
   - `JRC 永久水体`、`DEM`、`Slope`：排除常年水面与陡坡。
4. 点 **Flood (1) / Non-Flood (0) / Uncertain (-1)** 记录，选 `confidence`（2 高可信 / 1 一般可信 / 0 无法判断），自动跳下一点；点错用「撤销上一点」。
5. 判读完点 **导出判读结果 CSV**，再到 **Tasks 面板点 RUN** 才会真正导出到 Drive；同时点「打印已判 JSON」留一份备份。

**注意**：Code Editor 每次 Run 都会重置脚本状态，判读结果只存在内存里——请在一次会话内判完并导出；判不完就按事件分批（用 `RUN_EVENT_NAMES` 点名几场）。

---

## 6. 判读口径与注意事项

1. **盲判**：默认不显示伪标签、分层与置信度，避免开卷偏差；只有自查（`REVIEW_HIDE_PSEUDO = false`）才显示。面板始终显示抽样层名，仅用于导航。
2. **`reference` 含义**：1 = Flood，0 = Non-Flood，−1 = Uncertain。它是阈值合理性与精度评价的**唯一真值来源**。
3. **`confidence`**：2 = 高可信、1 = 一般可信、0 = 无法判断（0 是"无法判断"而不是"不可信"，统计时应单独一档看）。
4. **Unknown 要单列**：改动34 之后不少像元变成掩膜（`new_label = -1`），这些点既不能算对也不能算错，必须单独统计——当前 `validation_accuracy_report.py` 会把它们静默排除，尚未显式单列，需要用之前先补。
5. **判读顺序**：点名顺序即层序（非洪涝 → High → Medium → 差异·前已是水 → 差异·后不够暗）。后两层是判断阈值松紧的关键，建议优先判完；用「跳转」框可直接定位。
6. **不要用 Summary10 当答案**：它只是旧规则基线；面积/像元数的对比只用于归因和敏感性分析。

---

## 7. 与 `validation_points.js` 的 5 处差异

1. 顶部加本说明（第一阶段脚本没有）；
2. 关闭伪标签样本 CSV 导出（`EXPORT_ALL` / `EXPORT_PER_EVENT` / `EXPORT_SUMMARY` 全为 `false`）；
3. 去掉旧的「显示」块（它会把伪标签图层叠到 Map 上，违反文档第十六节）；
4. `buildEvent` 返回值多带一张 S2 RGB 真彩色合成（只用于判读显示，不影响抽样）；【改动34】又增加了 `reviewImage` / `stratum` / `stratumHist` / `roi`；
5. 【改动34】同步 4 个新阈值与 6 项 `sarFlood`；新增分层带与新/旧标签；判读点改从 `reviewImage` 上按层抽样；按事件留出 `tune` / `valid`。

> 因此**判读点不再与 `validation_points.js` 导出的样本表一一对应**——"被新约束删掉"的像元在训练样本里根本不存在，必须单独抽。

---

## 8. 已知限制与待办

| 级别 | 事项 | 说明 |
| --- | --- | --- |
| 必须 | 本版本**未在 GEE 实跑** | 只做了静态检查（`node --check`）；改动涉及阈值口径，必须在 Code Editor Run 并核对 Console 的分层像元数 |
| 必须 | `validation_accuracy_report.py` 处理 `new_label = -1` | 目前会静默丢点，必须单列统计 |
| 必须 | `flood_sens_ratio` / `n_flood_at_m35` / `n_flood_at_m45` 仍是旧候选规则 | 更新前不能作为新阈值的稳定性依据 |
| 注意 | 判读点的开销 | 当前跑三场，判读点上限 3 × 140 = 420 个（实际更少，受各层像元数限制）；每场多一次频率直方图请求。若扩到全量 18 场则最多 2520 点，判不完就按事件分批 |
| 注意 | 某层点数不足的报错 | 若 `stratifiedSample` 报该层点数不够，把 `REVIEW_POINTS_PER_STRATUM` 对应层上限调低 |
| 注意 | 4 个阈值是未标定初值 | 本轮就是为标定它们；标定后要同步回 `code/pseudo_labels1.js` 并重跑得到 `Summary12` |

---

## 9. 变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-09-27 | 第一阶段：`validation_points.js`（样本点表导出） |
| 2026-09-29 早 | 第二阶段：判读面板 + Reference 录入 + 判读结果导出（`validation_review.js` 成形） |
| 2026-09-29 晚 | 【改动34】同步 Sentinel-1 预/后向散射约束；新增分层带与新旧标签；判读点改五层分层抽样；面板与导出增补；事件按 `tune` / `valid` 留出 |
