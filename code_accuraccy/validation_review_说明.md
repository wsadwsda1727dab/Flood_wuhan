# `validation_review.js` 说明文档

> 对应版本：2026-10-14（含【改动34】Sentinel-1 预/后向散射约束 + 五层分层抽样、【改动35】判读点抽样尺度与统计尺度分离、【改动37】移除训练样本点链、【改动38】移除汇总表链、【改动39】移除 S2 后窗越界尾段诊断、【改动40】判读点抽样 `dropNulls: false` 修复第 3/4 层被整层剔除、【改动41】判读点抽样尺度由 10 m 改为 30 m）
> 同目录相关文件：`validation_points.js`（第一阶段，导出样本点 CSV）、`阈值合理性与精度评价流程.md`（整体链路与原则）
> 精度核算：原本地脚本 `validation_accuracy_report.py` 已于 2026-10-20 删除，改为读判读 CSV 现算，口径见 `csvdata/validation_points/判读结果分析与阈值评价_20261019.md`。

---

## 1. 这个文件做什么

`validation_review.js` 是**伪标签精度评价的第二阶段**——「目视判读工作台」，在 Google Earth Engine Code Editor 里运行。它做四件事：

1. 复用第一部分的标签生成代码，为每个事件算出证据图层；
2. 生成一批**待判读点**（本版本按五层分层抽样）；
3. 提供面板，让你逐点看遥感证据、盲判 Flood / Non-Flood / Uncertain，并记录 `confidence`；
4. 把判读结果导出成 CSV（`reference`），供本地精度核算使用（口径见 `csvdata/validation_points/判读结果分析与阈值评价_20261019.md`；原 `validation_accuracy_report.py` 已删除）。

它**只服务目视判读精度评价**，两轮收敛都朝这个方向：

- 【改动37】`buildEvent` 里原本那条「按 `label` 抽正负两类训练样本点、导出样本 CSV」的链路整块移除——判读台不消费它，留着只会白跑一次 100 m × 每类 200 点的 `stratifiedSample` 和一次 `samples.size()` 阻塞请求，还会与主脚本【改动36】的 10 m 口径冲突。
- 【改动38】逐场汇总表链（`countImage`/`counts`、4.14 汇总行、4.15 S2 质控、`summaryFC` 与 `EXPORT_SUMMARY`）也整块移除——本文件不再产出任何汇总 CSV，需要汇总口径时看主脚本 `code/pseudo_labels1.js` 的 Summary 表。
- 【改动39】4.5b 的「S2 后窗越界尾段诊断」（开关 `S2_TAIL_DIAG`）同样整块移除——它只在"本场后窗伸进下一场暴雨"时才有输出，而三场命中事件（`2020_0628` / `2024_0621_0628` / `2025_0522`）的 `s2PostEnd` 都已定案写进事件表，按当前窗口实测命中为 0，分支根本不执行。**越界报警的护栏保留**：文件末尾【改动29】的 `reportS2WindowOverlaps()` 每次加载跑一遍（纯 JS、不连 GEE、零算力），新增事件或改窗时照样报警。

于是本文件**没有任何 `Export`**，唯一出口是第二部分面板上的「导出判读结果 CSV」按钮（`exportRecords()`）。

它**不是 Node 脚本**：依赖 `ee.*` / `Map.*` / `ui.*` / `Export.*`，本地只能做语法检查（`node --check`），必须到 Code Editor 里 Run。

---

## 2. 当前版本的整体结构

| 位置 | 内容 | 来源 |
| --- | --- | --- |
| 开头注释 | 与 `validation_points.js` 的 6 处差异 | 【第二阶段】【改动34】【改动37】【改动38】【改动39】【改动40】 |
| 0 节 | 研究区（`wuhan` 资产） | 复用 |
| 1 节 | 全局参数：判识阈值、抽样参数、窗口参数、去偏/云掩膜/诊断开关 | 复用 + 【改动34】4 个新阈值；【改动38】删质控三阈值与 `SUMMARY_SELECTORS`；【改动39】删 `S2_TAIL_DIAG` |
| 2 节 | 事件表 `EVENTS`（20 条 = 18 场暴雨 + 2 场对照）、`RUN_EVENT_NAMES`、`VALIDATION_EVENT_NAMES` | 复用 + 【改动34】tune/valid 留出 |
| 3 节 | 时间窗口工具函数（北京时 → UTC、事件前/后窗口推导） | 复用 |
| 4 节 | `buildEvent(ev)`：单场事件的 SAR + 光学标签与证据（4.1–4.16） | 复用 + 【改动34】4.10b；**【改动37】4.13 训练样本链已移除**；**【改动38】4.12、4.14、4.15 汇总链已移除**；**【改动39】4.5b 尾段诊断已移除** |
| 5 节 | 逐时段执行 `RUN_EVENT_NAMES` 过滤 + `EVENTS_TO_RUN.map(buildEvent)` | 复用 + 【改动37】去掉 `allSamples` 合并与 3 条样本 print；【改动38】去掉 `summaryFC` 与汇总 print |
| 6 节 | 旧的「显示」块（伪标签图层）——**已移除**，避免暴露答案 | 【第二阶段】 |
| 7 节 | 导出开关——【改动37】删 `EXPORT_ALL` / `EXPORT_PER_EVENT`；【改动38】删 `EXPORT_SUMMARY`，**本文件已无任何 Export** | 【第二阶段】+【改动37】+【改动38】 |
| 第二部分 7.1 | 判读点表：按五层分层抽样（【改动35】抽样尺度与统计尺度分离；【改动40】`dropNulls: false`；【改动41】尺度由 10 m 改 30 m） | 【改动34】重写 +【改动35】+【改动40】+【改动41】 |
| 第二部分 7.2 | 判读状态与图层管理（证据图层、点图层、高亮） | 【第二阶段】 |
| 第二部分 7.3 | 判读面板与按钮 | 【第二阶段】+【改动34】增补显示 |
| 第二部分 7.3 之后 | 记录 `record()`、撤销、`leanRecords()`、导出 CSV/底表（源码里没有独立小节标题） | 【第二阶段】+【改动34】导出列 |

### `buildEvent` 内部（4 节）分步

| 小节 | 内容 |
| --- | --- |
| 4.1 / 4.2 / 4.3 | S1 前/后时相收集、S2 光学（L2A 优先、可被事件表强制 `s2Source`）、数据可用性检查 |
| 4.4 | SAR 时相合成与变化量：`VV_pre` / `VH_pre` / `vv_post_c` / `vh_post_c`、`vv_diff`、`vh_diff`、`VV_ratio`、`s1Valid`、逐景去偏 |
| 4.5 / 4.5b | 光学证据（逐景算指数后取 `max`）；**4.5b【改动39】已移除**（原为 S2 后窗越界尾段诊断） |
| 4.6 | DEM / 坡度 / JRC 永久水体 |
| 4.7 / 4.9 | 洪涝类（High / Medium Flood）与非洪涝类（High / Medium Non-Flood） |
| 4.8 | SAR 稳定区（相对全 ROI 差值中位数 ± 容差） |
| 4.10 | 最终 `label` 与 `conf_flood` / `conf_nonflood`（含正负冲突保护） |
| **4.10b** | **【改动34】判读分层带 `stratum` + 新旧标签 `new_label` / `old_label` / `old_sar_flood`**；**【改动35】分层像元直方图的计数尺度改用 `REVIEW_SAMPLE_SCALE`**（【改动41】该常量为 30 m） |
| 4.11 | 特征栈（波段名与顺序与原 `temp.js` 一致，下游脚本不用改） |
| 4.12 | **【改动38】已移除**（原为逐场像元统计 `countImage` / `counts`，8 波段 sum，100 m） |
| 4.13 | **【改动37】已移除**（原为按 `label` 抽训练/验证样本点并导出样本 CSV） |
| 4.14 / 4.15 | **【改动38】已移除**（原为汇总行 41 列、S2 光学覆盖质控 `s2_cover_valid_frac` / `high_flood_share` / `s2_qc_flag`） |
| 4.16 | 诊断输出（`DIAG = true` 时才跑） |

---

## 3. 本版本新增内容（重点）

> 3.1–3.5 为【改动34】引入、3.3 含【改动35】；3.6 为【改动37】的移除，3.7 为【改动38】的移除，3.8 为【改动39】的移除，3.9 为【改动40】的修复，3.10 为【改动41】的尺度调整。

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

| 值   | 键名             | 含义                                            |
| --- | -------------- | --------------------------------------------- |
| 0   | `nonflood`     | 非洪涝（新规则未判洪）                                   |
| 1   | `high_flood`   | High Flood（判洪 + 光学背书，`conf_flood = 2`）        |
| 2   | `medium_flood` | Medium Flood（判洪 + 窗口内无 S2，`conf_flood = 1`）   |
| 3   | `cut_prewater` | **版本差异层**：约束前判洪、约束后不判洪，原因是事件前已是水（未过 `pre` 条件） |
| 4   | `cut_postweak` | **版本差异层**：同上，原因是事件前非水、事件后不够暗（未过 `post` 条件）    |

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
| 抽样尺度 `scale` | `SAMPLE_SCALE = 100 m` | **`REVIEW_SAMPLE_SCALE`**（【改动35】，原 10 m；【改动41】改为 30 m） |
| 能否抽到"被删像元" | **不能**（这类点在新标签下已不是洪涝） | 能，第 3、4 层就是（但**必须**配【改动40】的 `dropNulls: false`，否则被整层剔除，见 3.9） |

每层点数取 `min(该层上限, 该层实际像元数)`，像元不足自动少抽；某层像元数为 0 时该层不出点。各层像元数在 Console 里以频率直方图打印。

**【改动35】抽样尺度与统计尺度分离**：判读点的 `scale` 从 `SAMPLE_SCALE`(100 m) 换成 `REVIEW_SAMPLE_SCALE`（`validation_review.js:1504`；【改动38】前的行号是 1723，【改动40】前的行号是 1486）。动机是不用统计尺度的百来米聚合值——用 100 m 会把点位落到格中心、取值是格内聚合值，双方测的不是同一块地（100 m 格在武汉纬度东西向仅约 86 m，一个格子里装的是上百个像元的均值或多数类）。

> **【改动41】该常量已由 10 m 改为 30 m**（`validation_review.js:78`）：【改动35】原取 10 m 以求"判定尺度 = 判读尺度"，但 10 m 下点位过多、单场判读台跑不出来，故放宽到 30 m 折中（仍是像元级，非格内大幅聚合）。**原"= 判读尺度"的表述随之作废**：30 m 不等于判读员所看的尺度。**已知代价**：`VV_pre` / `VH_pre` / `VV_post_c` / `VH_post_c` / `MNDWI` 都变成 30 m 聚合值，而它们是【改动34】四个阈值的直接输入，用聚合值标定像元级阈值不能直接回填主脚本的 10 m 逻辑。详见第 9 节变更记录与 8 节待办。

同一改动还包含一处**连带的必要修复**：4.10b 的分层像元直方图也从 100 m 改到 `REVIEW_SAMPLE_SCALE`（`validation_review.js:1121`；【改动38】前的行号是 1219，【改动40】前的行号是 1112）。直方图计数单位必须与抽样单位相同，否则 `min(该层上限, 该层像元数)` 拿到的是"100 m 格数"，会把像元少的层压到上限以下（例：某层 10 m 有 1800 个像元、落到 100 m 只剩 18 格，就只会抽 18 点而不是 20 点）。该式中的"像元数"随【改动41】也变成 30 m 格数，**只会更小**，实际点数可能进一步低于配额上限。

该常量只用于第二部分的判读点抽样与分层计数，**不动任何统计量、不动特征栈、不动四个阈值**，因此 Summary 表与阈值标定都不受影响。

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

### 3.6 【改动37】移除训练样本点链（本文件只留判读）

**为什么删**：本文件已定为「只用于目视判读精度评价」，而 `buildEvent` 4.13 那条按 `label` 抽正负两类的样本点链，产物只有样本 CSV，判读台完全不消费；它的三个导出开关也都关着。留着有三项成本：

1. 每场白跑一次 `scale = SAMPLE_SCALE`(100 m) × 每类 `POINTS_PER_CLASS`(200) 点的 `stratifiedSample`；
2. 一次 `samples.size()` 阻塞往返，与 `code/pseudo_labels1.js` 全量跑报错（`Failed to send on XMLHttpRequest`）同型；
3. 口径冲突——主脚本【改动36】已把样本点改到 10 m，这里仍是 100 m，`EXPORT_PER_EVENT` 一翻 `true` 就会静默导出错误尺度的样本。

**删掉的内容**（`validation_review.js`）：

| 位置 | 内容 |
| --- | --- |
| 1 节 | `POINTS_PER_CLASS`（原 200）、`SAMPLE_SELECTORS`（原 18 列） |
| 4.13 | 配额 `nFloodC` / `nNonFloodC`、`stratifiedSample({classBand:'label' … seed: SAMPLE_SEED})`、`.map` 打事件属性、`nSamples = samples.size().getInfo()` |
| 4.13 print | 「样本 N 条」一段 |
| 4.14 | `summary.sample_count` / `summary.status` 不再由样本数决定（当时固定为 `null` / `'OK'`；这两个字段连同整个 4.14 已在【改动38】删除） |
| 4.16 | return 对象的 `samples` 键 |
| 5 节 | `allSamples` 合并、`allSamples.size()`、两条 `aggregate_histogram`、print 里的「有样本的时段」（改为「跳过（无 S1）的时段」） |
| 7 节 | `EXPORT_ALL`、`EXPORT_PER_EVENT` 两个开关及其两块导出 |

**保留的内容**：`SAMPLE_SCALE`(100 m，统计尺度)、`SAMPLE_SEED`（判读点抽样仍在用）、4.10b 分层带与 `stratumHist`、4.11 特征栈、`reviewImage`、`counts` 与 4.12/4.14/4.15 统计（这三段在【改动38】又被整体删除，见 3.7）、第二部分整段。

**对判读零影响**：判读点走的是 `buildReviewPoints()`（`classBand:'stratum'` 五层、`scale = REVIEW_SAMPLE_SCALE`、`seed = SAMPLE_SEED`），与 4.13 的样本链互不引用——`samples` 在删除前除导出与 print 外无任何消费者。判读点的数量、位置、顺序与随机性都不变。

**注意**：当时 `summary.sample_count` 列恒为 `null`（【改动38】后该列已不存在）。若与 `csvdata/pseudo_labels/Wuhan_2016_2025_Flood_Event_Summary11.csv` 对比，该列是真值缺失，不要当成 0 参与统计。

### 3.7 【改动38】移除汇总表链（本文件不再产出任何汇总 CSV）

**为什么删**：【改动37】之后，本文件剩下的产物只有两样——判读结果 CSV，和 `buildEvent` 里那条逐场汇总表链。后者是第一阶段 `validation_points.js` 的遗留：`SUMMARY_SELECTORS` 41 列 + `summaryBase()` + 4.12 `counts` + 4.14 汇总行 + 4.15 S2 质控 + `summaryFC` + `EXPORT_SUMMARY`。判读台一个字段都不读，却每场都要付代价：

1. 4.12 `countImage`(8 波段) 的 `reduceRegion` + `getInfo()`：一次全幅像元计数往返；
2. 4.14 `nFloodAt(-3.5)` / `nFloodAt(-4.5)` 两次全幅 `sum`、`s1_valid_cover` 一次全幅 `mean`、两次 `pixelArea` 全幅 `sum`；
3. 4.16 之前的 `print('每时段汇总表:', summaryFC)` 一句就会把整条链拉起来求值——Console 里看不到汇总表，代价却照付。

**删掉的内容**（`validation_review.js`）：

| 位置 | 内容 |
| --- | --- |
| 1 节 | `LOW_S2_COVER_MIN` / `MIN_HIGH_FLOOD_SHARE` / `NO_OPTICAL_COVER` 三个质控阈值、`SUMMARY_SELECTORS` 41 列 |
| 4.12 | `countImage`(8 波段) + `counts` 的 `reduceRegion().getInfo()` + 两条像元数 print |
| 4.14 | `sensCommon`（原定义处）、`nFloodAt(thr)`、`summary` 全字段赋值（7 列 counts、`s1_valid_cover`、`debias_mode`、`vv_offset_db` / `vh_offset_db`、`offset_spread_db`、`n_flood_at_m35` / `m45` / `flood_sens_ratio`、`flood_area_km2` / `valid_area_km2`、`sample_count` / `status`） |
| 4.15 | S2 光学覆盖质控（`n_valid_px` / `s2_cover_valid_frac` / `high_flood_share` / `s2_qc_flag`）与 `NO_OPTICAL` 警告 print |
| 4.16 前的 `summaryBase()` | 41 列基础字段构造器及它的两个调用点（跳过分支、4.14） |
| 4.16 | return 对象的 `summary` 键；跳过分支简化为 `{name, skipped:true}` |
| 5 节 | `summaryFC` 构造与 `print('每时段汇总表:', summaryFC)` |
| 7 节 | `EXPORT_SUMMARY` 开关与其导出 |

**保留的内容与理由**：

- `sensCommon` 本身保留，但定义迁到 4.16 `if (DIAG)` 分支内（`s1Valid.and(lowSlope).and(nonPermanentWater).and(opticalFlood.or(s2Valid.not()))`）——它是 DIAG 五档阈值敏感性分析唯一剩下的消费者；
- `lowSlope` / `nonPermanentWater` / `opticalFlood` / `s2Valid` / `floodUsed` / `nonFloodUsed` / `highFlood01` / `mediumFlood01` / `highNonFlood01` / `mediumNonFlood01` 全部保留——它们是 `label`、`conf_*`、`stratum` 的上游，判读链依赖；
- `s1preCol` / `s2srCol` / `s2l1cCol`、`avail`、`s2Source` 全部保留——既喂真影像合成，也喂数据可用性检查与跳过判定。

**对判读零影响**：判读点走 `r.reviewImage`（4.11 特征栈 + `stratum` + 新旧标签 + 4 个阈值输入），`stratumHist` 走 4.10b，都与 4.12/4.14/4.15 无引用关系。判读点的数量、位置、顺序与随机性不变；`REVIEW_SELECTORS` 27 列一个不少。

**副作用**：Console 不再打印每场「洪涝 N 像元 / 非洪涝 N 像元」，也不再打印逐景偏移与 S2 质控摘要——这些量要么看主脚本 `code/pseudo_labels1.js` 的 Summary 表，要么把 `DIAG` 打开看诊断输出。另：4.4 的 `vv_offset_db` / `vh_offset_db` 记录说明、`S2_INDEX_STAT` 的 `s2_index_stat` 口径记录说明，都已在注释里标注「随汇总表移除」。（4.5b 的 `s2_valid_px` 同口径说明随该段在【改动39】一起消失。）

**边界**：本文件不再有任何 `Export`。以后要汇总表就在主脚本里跑，不要在判读台里恢复这条链——它每场多付 5～6 次全幅 reduce 往返，而判读本身不需要这些数。

### 3.8 【改动39】移除 S2 后窗越界尾段诊断（4.5b / `S2_TAIL_DIAG`）

**为什么删**：4.5b 是【改动31】为解决「逐景 `max` 把下一场暴雨的水并进本场标签」而加的诊断——它比较「整窗有效像元」与「只在重叠尾段有效的像元」(`n_tail_excl`)，输出一个 5% 阈值结论（>5% 就别截、≤5% 可以截）。它的历史使命已经完成：

- 三场曾命中的事件（`Wuhan_2020_0628`、`Wuhan_2024_0621_0628`、`Wuhan_2025_0522`）的 `s2PostEnd` 都已按诊断结果写进事件表；
- 按当前事件表实测**越界命中 = 0**（`s2WindowOverlapHits` 对 18 场暴雨两两比对，`s2PostEnd` 已定案后无任何一场后窗伸进下一场）；
- 该诊断的 `reduceRegion` 本来就包在 `if (tailHits.length > 0)` 之内，命中为 0 时**不产生任何 GEE 请求**——所以这一档省的不是算力，是代码量与一处开关。

**删掉的内容**（`validation_review.js`）：

| 位置 | 内容 |
| --- | --- |
| 1 节 | `var S2_TAIL_DIAG = true;` 与其注释块 |
| 4.5b | 整段诊断：`tailHits` / `tailCutJs` / `tailHeadCol` / `tailCol` / `tailHeadValid` / `tailValid` / `tailDiag`(5 波段 `ee.Image.cat`) / `reduceRegion` / `nWindowValid` / `nHeadValid` / `nTailExcl` / `tailExclShare` / 三条 `print` |
| 注释 | 4.5b 标题块、`s2WindowOverlapHits` 里"两处共用一条判定"、`s2ValidBand` 里"与尾段诊断共用同一写法"、事件表 `Wuhan_2025_0522` 里"【改动31】诊断也不再触发"、对照事件说明里"与尾段诊断都会跳过" |

**保留的内容与理由**：

- **`s2WindowOverlapHits(ev)` 保留**——它是纯 JS 判定函数，末尾的【改动29】启动自检 `reportS2WindowOverlaps()` 仍靠它打全表；删掉它等于拆掉护栏。
- **`reportS2WindowOverlaps()` 与它的调用保留**——脚本加载时跑一次，不连 GEE、零算力，是"以后新增事件或改窗时自动发现越界"的唯一机制。
- `s2ValidBand` / `isoDate` / `bjToUTC` / `S2_POST_PAD_DAYS` / 事件表的三个 `s2PostEnd` 全部保留（各有主流程用途）。

**对判读零影响**：4.5b 只做诊断打印，不写任何被 `label` / `stratum` / `reviewImage` / `stratumHist` 引用的量。判读点数量、位置、顺序与随机性不变。

**副作用**：Console 不再出现 `【改动31】… S2 后窗越界尾段诊断` 这一组打印。**注意**：当前窗口下它本来就不会打印（命中为 0），所以正常全量跑的 Console 输出**看不出差别**——不要用"Console 没变"反推改动没生效。

**若要重新量化**：按 `doc/labelConsole2.md` 的口径单独跑（`Wuhan_2025_0522` 那组数：整窗 755,178 px、只在尾段有效 4,444 px = 0.6%）。不要在判读台里恢复这条链。

### 3.9 【改动40】判读点抽样显式 `dropNulls: false`（修复第 3/4 层被整层剔除）

**现象（2026-10-14 实测）**：`RUN_EVENT_NAMES` 三场里 `Wuhan_2020_0705` 的 Console 直方图给出五层像元数 `0: 2002402.6 / 1: 160303.0 / 2: 33962.7 / 3: 75502.4 / 4: 24535.7`，层表与配额表逐项对齐（诊断输出 `["0:nonflood=20","1:high_flood=20","2:medium_flood=20","3:cut_prewater=40","4:cut_postweak=40"]`），按 `min(上限, 像元数)` 本场应出 **20/20/20/40/40 = 140** 点；实际 Console 打印 `{"Wuhan_2020_0705": 60}`——恰好是 0/1/2 三层之和，第 3、4 层一个点都没有。

**根因**：`reviewImage` 里带着 `label` 波段（4.10 的 `sampleImage = featureStack.addBands(label)…`，`reviewImage` 由它派生），而 `label` 的掩膜是 `knownArea = floodUsed.or(nonFloodUsed)`（4.10）。第 3/4 层的定义 `droppedByNewThr = oldFloodUsed.and(floodUsed.not())` 按构造就落在 `knownArea` **之外**，所以这两层的候选点在 `label` 波段上恒为 no-data；第 0/1/2 层全部在 `knownArea` 之内，`label` 有值。`stratifiedSample` 默认 `dropNulls: true`，会丢弃**任一**波段为 null 的样本，于是第 3/4 层被整层剔除，返回的正好是 60。

> 注意这不是"第 3/4 层没有像元"，也不是"直方图数成 0"——两者都被本次实测推翻。原始注释「label 保留掩膜 → Unknown 区域不会进入抽样」（4.10b 之前）描述的是作者本意，但它同时把差异层也筛掉了，属副作用。

**改动（`code_accuraccy/validation_review.js`）**：

| 位置（改后行号，已含【改动41】的位移） | 改动 |
| --- | --- |
| 文件头 `:24-26` | 差异清单新增第 6 条：【改动40】抽样显式 `dropNulls:false` + "请求数 vs 实际返回数"诊断 print |
| `:1143-1145` | `label` 保留掩膜处的注释扩写，点明"抽样时必须配 `dropNulls:false`（见 7.1 `buildReviewPoints`）" |
| `:1509-1516` | `stratifiedSample` 参数块新增 `dropNulls: false`（位于 `seed` 之后、`tileScale` 之前） |
| `:1491` | `total === 0` 的早退返回由 `FeatureCollection` 改为 `{fc: ee.FeatureCollection([]), requested: 0}` |
| `:1519-1532` | `buildReviewPoints(r)` 返回值改为 `{fc, requested}`（`requested = total`），函数头补注释说明两数不等即代表有波段掩膜在筛点 |
| `:1539` / `:1541-1551` | 新增 `REVIEW_REQUESTED`；`results.forEach` 改读 `built.fc` / `built.requested` |
| `:1555-1558` | 新增诊断 print：`【改动40】请求点数 vs 实际返回点数（不等即有波段掩膜在筛点）`（`:1555` 注释、`:1556-1558` print 本体） |

未改动：原有那条 `print('判读事件与候选点数…')`（`:1553-1554`）保留原样，`REVIEW_COUNTS` 语义不变（仍是实际返回点数）；导出 29 列不受影响（`label` 本就不在 `REVIEW_SELECTORS` 里）。

**改后预期**：`Wuhan_2020_0705` 打印 `140 → 140`（20/20/20/40/40），三场上限 420。若仍出现两数不等，新 print 会直接指出还有别的波段在筛点。

> 【改动41】追上来的影响（2026-10-14 补注）：上面「140 → 140」是 **10 m 口径**下的预期。该常量随后被【改动41】改为 30 m，分层直方图的计数单位随之变成 30 m 格，`min(40, 该层格数)` 里的格数变小，因此**请求数不一定还是 140**（可能低于 140，极端情况层 3/4 的格数被压到很小）。判据不变：**箭头两侧相等**即说明没有波段把候选点筛掉；「等于 140」不再是判据。

**验证情况**：**未在 GEE 实跑**（本次会话 `ops_bash` / `pwsh` 两个后端均不可用，`node --check` 未能执行），语法为人工逐行核对。`dropNulls` 默认值为 `true` 是从"恰好多丢第 3/4 两层"的行为反推的，**未核对 GEE 官方文档**——若要严格确认，需在 GEE 文档或实跑中验证。

### 3.10 【改动41】判读点抽样尺度由 10 m 改为 30 m

**触发（2026-10-14）**：【改动35】把判读点抽样尺度设成 10 m（= 判读尺度），但 10 m 下点位过多，单场事件在 Code Editor 里跑不出来，一次判读都完不成。故把 `REVIEW_SAMPLE_SCALE` 放宽到 30 m 取折中：仍是像元级（不是 100 m 的格内大幅聚合），但点数比 10 m 少一个量级。

**改动**：只改了一处常量赋值，其余全是同步注释。

| 位置（改后行号） | 改动 |
| --- | --- |
| `:68-78` | 常量块头部注释改写：删掉"判定尺度就是判读尺度，两者必须一致"的断言（30 m 下不再成立），改为【改动41】的折中理由与已知代价 |
| `:78` | `var REVIEW_SAMPLE_SCALE = 10;` → `= 30;`；同行注释由"判读点抽样尺度（m）：= 判读尺度"改为"判读点抽样尺度（m）" |
| `:27-29` | 文件头差异清单新增第 7 条：【改动41】 |
| `:1112-1118` | 4.10b 直方图注释：把"从 100 m 改为 10 m"的定点写法改回变量名，加一行【改动41】说明 |
| `:1380-1381` | 7.1 导语注释：同步尺度表述（原写"10 m = 判读尺度"） |
| `:1497-1504` | `stratifiedSample` 的 `scale` 注释：同步，并写明 30 m 聚合值不能直接用于标定像元级阈值 |

**未改动**：`SAMPLE_SCALE = 100 m`（统计尺度）、特征栈、四个 S1 阈值（`VV_PRE_NONWATER_TH` / `VH_PRE_NONWATER_TH` / `VV_POST_WATER_TH` / `VH_POST_WATER_TH` 的值一个没动）、两个相对阈值、配额表 `REVIEW_POINTS_PER_STRATUM`（仍 20/20/20/40/40）、五层定义、`REVIEW_SELECTORS` 29 列、判读面板与导出逻辑。该常量的两个使用点（`:1121` 分层像元直方图、`:1504` 判读点抽样）都是引用变量，随常量联动，无硬编码 10。

**连带影响**：

- 分层像元直方图的计数单位变成 30 m 格 → `min(该层上限, 该层像元数)` 里的像元数变小，实际点数可能进一步低于 140/场；
- 点位（经纬度）与 10 m 那批完全不同，两次导出不可合算（已实测：30 m 单场 60 点与 10 m 三场 141 点里的同场点，坐标逐点无一相同）；
- 导出的 `VV_pre` / `VH_pre` / `VV_post_c` / `VH_post_c` / `MNDWI` 变成 30 m 聚合值。

**已知代价（标定前必须考虑）**：这四个后向散射列正是【改动34】四个阈值的直接输入。用 30 m 聚合值去标定像元级阈值，**标定结果不能直接回填主脚本 `code/pseudo_labels1.js` 的 10 m 逻辑**。若最终目的是给主脚本定阈值，应在标定阶段回到 10 m 抽样；若确定长期用 30 m，则需在文档中明确"阈值按 30 m 口径标定"并同步调整主脚本尺度。

**验证情况**：**未在 GEE 实跑**；本次会话两个执行后端均不可用，`node --check` 未能执行。改动是一处数值赋值，语法风险为零，行号已逐条 `ops_grep` 复核。

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
| `LOW_S2_COVER_MIN` / `MIN_HIGH_FLOOD_SHARE` / `NO_OPTICAL_COVER` | — | **【改动38】已删除**（原为 S2 覆盖质控三档，唯一用途是写 `s2_qc_flag`） |
| `DIAG` | `false` | 诊断开关（逐景偏移、阈值敏感性、目视图层） |
| `S2_TAIL_DIAG` | — | **【改动39】已删除**（原为相邻暴雨 S2 后窗越界尾段诊断；越界报警改由文件末尾【改动29】`reportS2WindowOverlaps()` 每次加载跑一次承担，纯 JS、零算力） |

### 4.3 抽样与事件范围

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `SAMPLE_SCALE` | 100 m | **统计尺度**（去偏/稳定区中值、DIAG 诊断的像元量）；【改动35】起不再用于抽样点位，【改动38】后不再产出计数列与面积 |
| `REVIEW_SAMPLE_SCALE` | **30 m** | **【改动35】判读点抽样尺度**：只作用于 7.1 的判读点抽样与 4.10b 的分层像元直方图；不动任何统计量。**【改动41】由 10 m 改为 30 m**——10 m 下点位过多、单场判读台跑不出来。注意 30 m 已不等于判读尺度，且导出的 `VV_pre` 等四列为 30 m 聚合值，不能直接用于标定像元级阈值 |
| `SAMPLE_SEED` | 20260927 | 抽样随机种子；【改动37】起只用于判读点抽样（7.1） |
| `dropNulls`（`stratifiedSample` 调用参数） | `false` | **【改动40】必须显式传 `false`**：`reviewImage` 的 `label` 波段在 `knownArea` 外无值，而第 3/4 层按构造就在 `knownArea` 外；用默认的 `dropNulls: true` 会把这两层整层丢掉（实测 140 → 60） |
| `POINTS_PER_CLASS` | — | **【改动37】已删除**（原为训练样本每类上限 200） |
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
4. **Unknown 要单列**：改动34 之后不少像元变成掩膜（`new_label = -1`），这些点既不能算对也不能算错，必须单独统计。`reference = -1`（未判读）与 `new_label = -1`（掩膜未定）不是一回事，核算时分别报数。
5. **判读顺序**：点名顺序即层序（非洪涝 → High → Medium → 差异·前已是水 → 差异·后不够暗）。后两层是判断阈值松紧的关键，建议优先判完；用「跳转」框可直接定位。
6. **不要用 Summary10 当答案**：它只是旧规则基线；面积/像元数的对比只用于归因和敏感性分析。

---

## 7. 与 `validation_points.js` 的 6 处差异

1. 顶部加本说明（第一阶段脚本没有）；
2. 【改动37】样本 CSV 的导出与整条训练样本点链已移除；【改动38】汇总表链（`counts` / 4.14 / 4.15 / `summaryFC` / `EXPORT_SUMMARY`）也移除，本文件**已无任何 `Export`**，唯一出口是判读结果 CSV 按钮；改前是三个开关全 `false`；
3. 去掉旧的「显示」块（它会把伪标签图层叠到 Map 上，违反文档第十六节）；
4. `buildEvent` 返回值多带一张 S2 RGB 真彩色合成（只用于判读显示，不影响抽样）；【改动34】又增加了 `reviewImage` / `stratum` / `stratumHist` / `roi`；
5. 【改动34】同步 4 个新阈值与 6 项 `sarFlood`；新增分层带与新/旧标签；判读点改从 `reviewImage` 上按层抽样；按事件留出 `tune` / `valid`；
6. 【改动40】7.1 的 `stratifiedSample` 显式传 `dropNulls: false`，否则第 3/4 层被整层剔除（原因见 3.9）；`buildReviewPoints` 返回值随之带出请求点数。
> 因此**判读点不再与 `validation_points.js` 导出的样本表一一对应**——"被新约束删掉"的像元在训练样本里根本不存在，必须单独抽。

---

## 8. 已知限制与待办

| 级别 | 事项 | 说明 |
| --- | --- | --- |
| 必须 | 本版本**未在 GEE 实跑** | 只做了静态检查（`node --check`）；改动涉及阈值口径，必须在 Code Editor Run 并核对 Console 的分层像元数 |
| 必须 | `new_label = -1`（掩膜未定）必须单列 | 原 `validation_accuracy_report.py` 会静默丢点，脚本已于 2026-10-20 删除；改由现算，仍须把该层单独报数 |
| 必须 | ~~`flood_sens_ratio` / `n_flood_at_m35` / `n_flood_at_m45`~~ | **【改动38】这三个字段已随汇总表链删除**（它们原本就还是旧候选规则，未随【改动34】更新）；新阈值的稳定性请用判读结果按层统计，不要再用这三个数 |
| 注意 | 判读点的开销 | 当前跑三场，判读点上限 3 × 140 = 420 个（实际更少，受各层像元数限制）；每场多一次频率直方图请求。若扩到全量 18 场则最多 2520 点，判不完就按事件分批 |
| 注意 | 某层点数不足的报错 | 若 `stratifiedSample` 报该层点数不够，把 `REVIEW_POINTS_PER_STRATUM` 对应层上限调低 |
| 必须 | **【改动40】未在 GEE 实跑** | `dropNulls: false` 的修复只有逻辑推演与 Console 现象吻合，未实跑验证；Run 后必须核对新增的「请求点数 vs 实际返回点数」print 两数相等（10 m 口径下 `2020_0705` 预期 `140 → 140`；30 m 下数字可能更低，判据是相等而非等于 140）。另 `dropNulls` 默认 `true` 未核对 GEE 官方文档 |
| 必须 | **【改动41】30 m 抽样与阈值标定口径冲突** | 【改动34】四个阈值是像元级阈值，而 30 m 下导出的 `VV_pre` / `VH_pre` / `VV_post_c` / `VH_post_c` 是格内聚合值。标定前必须先决定：回 10 m 抽样，还是接受"按 30 m 口径标定"并同步改主脚本。当前未决 |
| 注意 | **【改动41】未在 GEE 实跑** | 只改了一处常量（`:78`），未 Run 验证；Run 后应确认分层像元直方图计数随 30 m 明显下降、`【改动40】` 的两数仍相等 |
| 注意 | 4 个阈值是未标定初值 | 本轮就是为标定它们；标定后要同步回 `code/pseudo_labels1.js` 并重跑得到 `Summary12` |

---

## 9. 变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-09-27 | 第一阶段：`validation_points.js`（样本点表导出） |
| 2026-09-29 早 | 第二阶段：判读面板 + Reference 录入 + 判读结果导出（`validation_review.js` 成形） |
| 2026-09-29 晚 | 【改动34】同步 Sentinel-1 预/后向散射约束；新增分层带与新旧标签；判读点改五层分层抽样；面板与导出增补；事件按 `tune` / `valid` 留出 |
| 2026-10-14 | 【改动35】判读点抽样尺度与统计尺度分离：新增 `REVIEW_SAMPLE_SCALE = 10 m`，判读点抽样（7.1）与分层像元计数（4.10b）从 `SAMPLE_SCALE`(100 m) 改到它；统计尺度仍为 100 m。本文档 2 节结构表、3.3 节与 4.3 节同步更新 |
| 2026-10-14 | 【改动37】本文件定位收敛为「只做目视判读精度评价」：移除 4.13 训练样本点链（样本抽样 + `samples.size()` + `allSamples` 合并 + 样本 print）、`POINTS_PER_CLASS` 与 `SAMPLE_SELECTORS`、`EXPORT_ALL` / `EXPORT_PER_EVENT` 两个导出；`summary.sample_count` 固定为 `null`、`status` 固定为 `'OK'`。判读点链（5 层 / 10 m）不受影响。本文档 2 节结构表、4.3 节与新增 3.6 节同步更新 |
| 2026-10-14 | 【改动38】进一步移除汇总表链：4.12 `countImage` / `counts`、4.14 汇总行（`sensCommon` / `nFloodAt` / `summary` 全字段）、4.15 S2 质控、`summaryBase()` 与 `SUMMARY_SELECTORS`、`summaryFC` 与 `EXPORT_SUMMARY`、三个 S2 质控阈值。`sensCommon` 迁入 4.16 `DIAG` 分支；本文件此后无任何 `Export`，唯一出口是判读结果 CSV。判读点链（5 层 / 10 m）不受影响。本文档 2 节结构表、3.7 节（新增）与 4.2 / 4.3 / 7 / 8 节同步更新 |
| 2026-10-14 | 【改动39】移除 4.5b 的 S2 后窗越界尾段诊断（【改动31】）与开关 `S2_TAIL_DIAG`：三场命中事件的 `s2PostEnd` 已定案，按当前事件表越界命中为 0，该 `reduceRegion` 本就不执行。`s2WindowOverlapHits()` 与末尾【改动29】的启动自检保留（纯 JS、零算力，作为新增事件/改窗时的护栏）。判读点链不受影响。本文档 2 节结构表、3.8 节（新增）与 4.2 节同步更新 |
| 2026-10-14 | 【改动40】修复判读点抽样把第 3/4 层整层剔除：`stratifiedSample` 显式传 `dropNulls: false`，并新增"请求点数 vs 实际返回点数"诊断 print（`REVIEW_REQUESTED`）。根因是 `reviewImage` 携带的 `label` 波段在 `knownArea` 外无值，而差异层按构造就在 `knownArea` 外，默认 `dropNulls: true` 把它们全丢掉（`2020_0705` 实测 140 → 60）。`buildReviewPoints(r)` 返回值随之改为 `{fc, requested}`。本文档 3.9 节（新增）、4.3 节与 8 节同步更新 |
| 2026-10-14 | 【改动41】判读点抽样尺度由 10 m 改为 30 m：`REVIEW_SAMPLE_SCALE`（`validation_review.js:78`）由 `10` 改为 `30`，用于 7.1 判读点抽样与 4.10b 分层像元计数；统计尺度 `SAMPLE_SCALE`(100 m)、特征栈与四个 S1 阈值均未动。触发原因是 10 m 下点位过多、单场判读台跑不出来。代价：30 m 下 `VV_pre` / `VH_pre` / `VV_post_c` / `VH_post_c` 等列为聚合值，不能直接用于标定像元级阈值。本文档 3.3 节、3.10 节（新增）、2 节结构表、4.3 节与 8 节同步更新 |
