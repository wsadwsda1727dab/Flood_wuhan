# 武汉洪涝伪标签脚本（temp 系列）版本与诊断说明

> 整理自 2026-09-15 ~ 09-18 的调试过程，记录 `doc/temp*.js` 各版本的功能增量、所用诊断、已验证结论与待办事项。
> 仅新增本文档，未改动任何脚本文件。

---

## 1. 目标与范围

在 GEE Code Editor 中用 **Sentinel-1 变化检测 + Sentinel-2 光学证据**，为武汉市 2016–2025 年的 **19 场暴雨/洪涝事件**生成伪标签，并按事件分层抽样导出随机森林（RF）训练样本 CSV，供后续多年份洪涝制图实验使用。

| 项目 | 内容 |
|---|---|
| 研究区 | `projects/studied-glow-475306-v5/assets/wuhan` |
| SAR | `COPERNICUS/S1_GRD`（IW、VV+VH） |
| 光学 | `COPERNICUS/S2_SR_HARMONIZED`（L2A 优先）→ `COPERNICUS/S2_HARMONIZED`（L1C 回退） |
| 辅助 | `USGS/SRTMGL1_003`（DEM/坡度）、`JRC/GSW1_4/GlobalSurfaceWater`（永久水体） |
| 事件表 | `doc/2016_2025.docx`（19 个暴雨时段，含起止时间、影响区、雨量） |
| 输出 | 合并样本 CSV、每事件样本 CSV、每事件汇总 CSV（Google Drive） |

---

## 2. 文件清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `doc/temp.original.js` | 存档 | 最初版本：只跑 2016 单个事件，窗口写死；依赖外部模块（`users/PRO_STU1/Pro1:mode` 的 Otsu、`users/OEEL/lib:loadAll`） |
| `doc/temp.js` | 存档 | 改造为 19 事件逐时段执行，含【改动 1–15】 |
| `doc/temp1.1.js` | 存档 | 新增【改动16】带时刻日期、【改动17】后时相审计；后窗口起点改为事件结束、`POST_PAD_DAYS` 6→18 |
| `doc/temp1.2.js` | 存档 | 后时相改为「事件后最早 8 天 + 填充值掩膜 `updateMask(gt(-50))`」 |
| `doc/temp1.3.js` | 存档 | 新增【改动18】`dropFill` 公共化、【改动19】全局去偏、【改动20】覆盖率/偏移进 summary；修正导出 `selectors` 写反 |
| `doc/temp1.4.js` | 存档 | 新增【改动21】`DEBIAS_MODE` 三档 + 逐景去偏 `debiasOne` |
| **`doc/temp1.5.js`** | **当前主版本** | 新增【改动22】`DIAG` 开关 + 两个 QC 指标进 summary；修复「影像算术丢属性」报错 |
| `doc/events.js`、`doc/flood_pseudolabel.js` | 搁置 | 模块化方案（`require('users/<user>/<folder>:<script>')`），因 `Module not found` 未启用 |
| `doc/console.docx`、`doc/console1.1.docx` | 记录 | 两轮全量 Console 输出（首轮 19 事件；改动16/17 后一轮） |
| `doc/Wuhan_2016_Flood_PseudoLabel_RF.csv` | 记录（**当前工作区已不存在**） | 旧版 4000 点样本（2000/2000），对话中曾用它核对 `VV_diff`/`VV_ratio` 关系与 S2 缺失比例 |

---

## 3. 主流程（以 temp1.5 为准）

1. **事件循环**：`EVENTS`（19 个时段）→ `buildEvent(ev)` 逐个执行；`RUN_EVENT_NAMES` 可只跑指定时段。
2. **窗口推导**（`eventWindows`）：事件时间是北京时间，`bjToUTC` 换算成 UTC。
   - 前窗 = 事件开始 − `PRE_GAP_DAYS`(5) − `PRE_WINDOW_DAYS`(24) ~ 事件开始 − 5 天
   - 后窗 = **事件结束** ~ 事件结束 + `POST_PAD_DAYS`(18)（事件表里写了 `preStart/preEnd/postStart/postEnd` 的以手工值为准）
3. **S1 前时相**：`post/pre` 双窗口取 `filterBounds` + IW + VV/VH → `dropFill` 去除切片填充值 → `median()` 作为基线。
4. **S1 后时相**：取"事件后最早 8 天"的影像（跨 orbit 40 与 113，掩膜并集才盖满研究区）→ `dropFill` → **逐景去偏** → `median()`。
5. **差值**：`VV_diff = 后 − 前`、`VH_diff = 后 − 前`（用去偏后的后时相）；`VV_ratio` 仍由原始绝对后向散射算，保持物理可解释。
6. **有效像元**：`s1Valid` = 前后时相 VV/VH 四个掩膜取交集，只有这些像元参与判识。
7. **S2 光学**：后窗口的 L2A（无则 L1C）→ `QA60` 云掩膜 → 云量 ≤ 90% → 中值 → `NDVI`、`MNDWI`、`S2_Valid` 指示带。
8. **判识**：
   - SAR 洪水候选 `sarFlood01` = `VV_diff < -4.0` ∧ `VH_diff < -3.5` ∧ `s1Valid`
   - High Flood = 候选 ∧ 光学水 ∧ 非永久水体 ∧ 低坡度
   - Medium Flood = 候选 ∧ 无 S2 ∧ 非永久水体 ∧ 低坡度
   - 非洪涝 = SAR 稳定区（`|diff − 中位数| < 1.5 dB`）∧ 非永久水体 ∧ 低坡度（±光学非水）
   - 冲突保护：同时进入正负类时优先保留洪水 → `label`（0/1，Unknown 被掩膜）+ `conf_flood`/`conf_nonflood` 分带
9. **抽样**：`stratifiedSample`，`classPoints = [min(2000, 负类像元), min(2000, 正类像元)]`，scale 100 m，seed 42，样本带 `event_id/year/storm_*` 属性。
10. **导出**：合并样本 CSV、每事件 CSV、每事件汇总 CSV；`selectors` 固定列序（避免列错位）。

---

## 4. 全局参数表（temp1.5）

| 参数 | 值 | 含义 |
|---|---|---|
| `VV_THRESHOLD` | −4.0 dB | VV 后−前下降阈值 |
| `VH_THRESHOLD` | −3.5 dB | VH 后−前下降阈值 |
| `MNDWI_THRESHOLD` | 0.2 | 光学水体阈值 |
| `SLOPE_LIMIT` | 5° | 低坡度阈值 |
| `STABLE_TOLERANCE` | 1.5 dB | SAR 稳定区容差 |
| `PERMANENT_WATER_TH` | 90% | JRC 永久水体阈值 |
| `S2_MAX_CLOUD` | 90% | S2 整景云量上限 |
| `SAMPLE_SCALE` | 100 m | 抽样与统计尺度 |
| `POINTS_PER_CLASS` | 2000 | 每类最多抽样点数 |
| `SAMPLE_SEED` | 42 | 抽样随机种子 |
| `PRE_WINDOW_DAYS` / `PRE_GAP_DAYS` / `POST_PAD_DAYS` | 24 / 5 / 18 天 | 前窗长度 / 前窗与事件间隔 / 后窗向后长度 |
| `TZ_OFFSET_HOURS` | 8 | 北京时 → UTC |
| `S1_FILL_DB` | −50 dB | 低于此值视为 GRD 切片填充值 |
| `DEBIAS_MODE` | `'perImage'` | 去偏模式：`none` / `global` / `perImage` |
| `DIAG` | `false` | 诊断输出开关 |
| `RUN_EVENT_NAMES` / `VIEW_EVENT_NAME` | 当前均为 `['Wuhan_2025_0607']` | **全量运行前需改回 `null`** |
| `EXPORT_ALL/PER_EVENT/SUMMARY` | `true`（但导出块被注释） | 导出开关 |

---

## 5. 版本演进：每个版本新增了什么

### temp.original.js → temp.js：从单事件到 19 事件

把写死在函数里的窗口改成按事件推导，并补齐可用性判断。主要增量（脚本内以【改动 N】标注）：

- 【改动1】事件表 19 个时段；【改动2】时间窗口工具（北京时 → UTC）；【改动3】`buildEvent(ev)` 逐事件化
- 【改动4】数据可用性检查（缺 S1 就跳过该时段）
- 【改动5】新增 `s1Valid`：前后时相都有观测的像元才参与判识，避免把"无 SAR 数据"当成稳定区/非洪涝
- 【改动6】S2 改为 L2A 优先、无则回退 L1C，并加云量过滤（原版 2016 年完全拿不到 S2）
- 【改动7】删除外部模块依赖（Otsu 结果原本并未进入判识，却给每个时段加了一次外部依赖）
- 【改动8】正负样本冲突保护 + `conf_flood`/`conf_nonflood` 置信度分带
- 【改动9】像元统计合并为一次 `reduceRegion`（原来 3 次）
- 【改动10】分层抽样按实际像元数动态取 `min`
- 【改动11】样本带 `event_id/year/storm_*` 属性
- 【改动12】逐时段执行 + 每时段汇总表；【改动13】导出拆成合并/每事件/汇总三份
- 【改动14】Map 只显示一个时段（避免 19×10 个图层）；【改动15】`RUN_EVENT_NAMES` 支持只跑部分时段

### temp.js → temp1.1.js：后窗口语义修正 + 日期精化

- 【改动1（用户改）】后窗口起点从「事件开始 − 6 天」改为 **事件结束**，`POST_PAD_DAYS` 6 → **18 天**（覆盖 12 天重访 + 余量）
- 【改动16】日期打印**带上时刻**（北京时 `YYYY-MM-dd HH:mm`），并补上 S2 的日期 —— 原先只到天，同一天的影像分不出事件前后
- 【改动17】新增**后时相审计**：`s1_post_after_count` / `s1_post_after_dates`，并在"后窗口有影像但没有一景晚于事件结束"时打印警告

### temp1.1.js → temp1.2.js：后时相覆盖修复（用户改）

- 后时相从「整个 18 天窗口中值」改为「**事件后最早 8 天**（跨两条轨道）中值」，并把填充值掩掉：`.map(function (im) { return im.updateMask(im.gt(-50)); })`
- 起因：担心 18 天窗口把"已经退水"的影像混进来；同时单日窗口只能覆盖武汉约一半

### temp1.2.js → temp1.3.js：填充值统一、去偏、QC 字段、导出修正

- 【改动18】填充值过滤抽成 `dropFill(im)`（阈值 `S1_FILL_DB = -50`），**前时相也用**——前窗两条轨道各 4 景，某些像元可能只有一条轨道有数据
- 【改动19】整幅去偏（双差分，`DEBIAS = true`）：扣掉有效区内的中位偏移，使阈值含义从"比前窗基线低 4 dB"变成"比本事件典型变化再低 4 dB"
- 【改动20】`s1_valid_cover` / `vv_offset_db` / `vh_offset_db` 写进汇总表
- 删除 A/B/C 三段临时诊断（每个事件少 3 次请求）
- **修正导出 selectors 写反**：`allSamples` 原配了 `SUMMARY_SELECTORS`、`summaryFC` 原配了 `SAMPLE_SELECTORS`

### temp1.3.js → temp1.4.js：去偏从"全局一个数"升级为"逐景各扣"

- 【改动21】新增 `DEBIAS_MODE` 三档：`'none'` / `'global'` / `'perImage'`（默认 `perImage`），以及逐景去偏函数 `debiasOne(im)`
- 后时相拆成两份：`s1_post`（原始合成，供 `VV`/`VH`/`VV_ratio` 绝对特征）与 `postCorr`（去偏合成，仅供 `VV_diff`/`VH_diff` 与判识）
- 场景级偏移块拆成两半：`!== 'none'` 时测量并记录，`=== 'global'` 时才真正应用 —— `perImage` 模式下该值变成"校正残差"，用作自检
- `summary` 增加 `debias_mode` 列

### temp1.4.js → temp1.5.js：诊断收敛 + QC 指标进表（当前主版本）

- 【改动22】新增 `DIAG` 开关（默认 `false`）。`true` 时输出四项：逐景偏移一览、5 档阈值敏感性全表、参考期基线检验、目视图层（洪涝-不去偏/去偏/去偏新增）
- 新增 **QC 指标**写进 summary（正式跑数据也保留）：
  - `offset_spread_db` = 后时相各景自身偏移的 max − min（>0.5 dB 说明全局去偏不够用）
  - `n_flood_at_m35` / `n_flood_at_m45` / `flood_sens_ratio`（−3.5 与 −4.5 dB 两档的洪涝像元数及其比值）
- `debiasOne` 现在把每景偏移与时间/轨道记成自定义属性，供诊断表使用
- **修复报错**：影像算术会丢属性（连 `system:time_start` 也丢），导致诊断表 `ee.Date(null)` 报错；改为在 `debiasOne` 内显式带上 `t_bj` / `orbit`

---

## 6. 诊断工具箱（用过什么、结论是什么）

| 诊断 | 目的 | 结论 / 数值 | 现状 |
|---|---|---|---|
| 数据可用性（`s1_pre/post_count` + 带时刻日期） | 前后窗口有无影像、早晚 | 19 事件全部有前后影像；**前时相 4~8 景全部早于事件开始** | 保留（每事件打印） |
| 后时相审计 `s1_post_after_count` | 后窗口里有没有真正晚于事件结束的影像 | 修复前 2 个事件为 0 景；修复后全部 ≥1 | 保留（警告形式） |
| 逐景覆盖率 + 轨道（`mask()` 均值、`relativeOrbitNumber_start`） | 覆盖范围与轨道组成 | 每景 93.6%~99.8%（**但含填充值**）；前/后都由 orbit 40 + 113 组成 | 一次性 |
| `VV==0` 未掩膜检查 | 是否存在"填充 0" | 返回 null → **填充值不是 0，而是很大的负值** | 一次性 |
| 逐景偏移（每景相对前窗基线的中位差） | 各景背景偏移有多大、差多少 | orbit 40：+1.28~+1.75 dB；orbit 113：+0.25~+0.63 dB；**差 ~1.06 dB** | `DIAG = true` |
| 参考期基线（同轨最早 vs 最晚） | 无洪水期的漂移量级 | orbit 40 ≈ 0（+0.13）；orbit 113 ≈ **−1.13 dB**（后一景更暗）→ 漂移真实、由天气驱动 | `DIAG = true` |
| 阈值敏感性（最终洪涝像元数） | 结论对阈值的敏感度 | −3.0/−3.5/−4.0/−4.5/−5.0 → 2732/2370/2001/1670/1373，**每 0.5 dB ≈ −15%** | summary 存比值，全表在 `DIAG` |
| 新增像元黏连统计 | 去偏新增是"边缘扩张"还是"孤立散点" | 候选层：新增 5750 中 73% 孤立；标签层尚缺对照 | 一次性 |
| A/B/C 覆盖检查（`s1_post` 覆盖率、`VV==0` 占比、`vv_post` 覆盖率） | 定位覆盖率异常来自哪一环 | 三者一致（0.4607/0.46），说明 `vv_post` 确实来自 `s1_post` | 已删（临时） |
| `system:index` / `toDictionary()` 属性导出 | 判断同日两条记录是两帧还是两条轨道 | 同一天是相邻两片（Slice，25 s），跨日期才有不同相对轨道 | 一次性 |
| `capacity exceeded` 排查 | 交互会话配额被打满 | 19 事件 × 每事件多次**阻塞式** `getInfo`（`reduceRegion().getInfo()`、`size().getInfo()`） | 已通过窗口修复 + 分批运行缓解 |
| 导出 `selectors` | 防止 CSV 列名与取值错位 | 不加 `selectors` 时表头与取值顺序可能不一致；且曾把两处 selectors 写反 | 已修正 |
| 模块路径 `require()`（`events.js` / `flood_pseudolabel.js`） | 判断模块 ID 写法 | 格式为 `users/<用户>/<文件夹>:<脚本名>`；路径/大小写/保存状态任一不符即 `Module not found` | 方案搁置 |

---

## 7. 已验证的关键结论（含数值）

1. **前后时相可得性**：19 个事件在修正后窗口下都有事件前/后影像；前时相全部早于事件开始。
2. **单日 vs 多日覆盖**：只用事件后最早一天，`s1Valid` 覆盖率仅 **0.46**（后时相只覆盖武汉东部与北部）；改为"最早 8 天、跨两条轨道"后覆盖率 **= 1.00**。
3. **GRD 填充值**：切片无数据区的填充值是**很大的负值**（`mask()` 报告为有效），必须用 `dropFill` 显式掩掉，否则会产生 −30000 dB 量级的假变化。
4. **背景漂移真实存在**：同轨道相隔 12 天、无洪水期，orbit 40 ≈ 0、orbit 113 ≈ −1.1 dB → 漂移由天气（干湿）驱动，与几何无关。
5. **事件期偏移与轨道有关**：2025_0607 事件期 orbit 40 ≈ +1.28~+1.75 dB、orbit 113 ≈ +0.25~+0.63 dB，`offset_spread_db ≈ 1.06 dB` → 全局扣一个数会在两条轨道覆盖区残留 ±0.5 dB 偏差（沿轨道条纹），必须逐景去偏。
6. **阈值敏感性（同一模式内）**：每 0.5 dB 约 −15%，`flood_sens_ratio ≈ 1.42`（=−3.5 档 ÷ −4.5 档）。此前"0.75 dB 造成 52% 差异"的说法是**跨模式**比较（none/global/perImage），不是纯阈值敏感性。
7. **2025_0607 洪涝像元随处理方式的变化**：234（单日后窗口）→ 887（`none`）→ 1347（`global`）→ 约 2001（`perImage`，代理值与最终标签条件一致，待 summary 确认）。
8. **样本类别比例**：该事件从 2000 : 234 改善到 2000 : 1347（global）；正类像元数低于 2000 时按全量入样，无需再调抽样参数。
9. **S2 口径跨年不一致**：2016–2018 的事件多走 L1C/TOA（2018 两个事件甚至 L1C 有 8/22 景而 SR=0），2019 年起稳定走 SR/L2A → 跨年混训需按 `s2_source` 分层。
10. **事件定义存疑**：`Wuhan_2025_0607` 的雨量注记写的是"新洲张渡湖站 117.2 mm（**6 月 21 日**数据）"，而事件窗口是 6 月 7–9 日，需回查 `doc/2016_2025.docx`。

---

## 8. 已知问题与待办

| 优先级 | 事项 | 说明 |
|---|---|---|
| 高 | 确认 `perImage` 运行的自洽性 | summary 里 `n_flood_px` 应 ≈ 2001、`offset_spread_db` ≈ 1.06、`flood_sens_ratio` ≈ 1.42、`vv_offset_db`（残差）≈ 0、`s1_valid_cover` = 1 |
| 高 | 锚点事件验证 | 用 `perImage` 跑 `Wuhan_2020_0705`（432.5 mm，洪涝范围明确），核对其洪涝面积显著大于 2025_0607，且不放宽阈值前不应大面积误判 |
| 高 | 全量运行前收尾 | `RUN_EVENT_NAMES = null`、`VIEW_EVENT_NAME` 设为代表事件、`DIAG = false`、按需取消三个 `Export` 块注释 |
| 中 | 事件定义回查 | 至少核对 `Wuhan_2025_0607`、以及 2016 两个事件的日期与雨量 |
| 中 | 跨事件一致性评估 | 导出 summary 后比较 `s1_valid_cover` / `offset_spread_db` / `n_flood_px` vs `rain_ref_mm` |
| 中 | 分类不平衡处理 | 少量事件正类仅 150~300 像元；合并训练时按事件配额（每事件每类上限）或分层加权，评价用洪涝类 F1/IoU |
| 低 | 自适应阈值（可选） | 原脚本的 Otsu 思路仍可作为对照方案；也可考虑用前窗标准差做 z-score 归一 |
| 低 | 模块化整理 | `events.js` + `flood_pseudolabel.js` 方案若要用，需先确认 `users/<用户>/<文件夹>:<脚本>` 的真实路径 |

---

## 9. 使用说明

### 9.1 三个开关

| 场景 | 设置 |
|---|---|
| 正式出数据 | `DIAG = false`（默认） |
| 复核单个事件 | `DIAG = true` |
| 去偏三档对照 | 改 `DEBIAS_MODE`：`'none'` / `'global'` / `'perImage'` |

> 参照点：`Wuhan_2025_0607` 在 `none` / `global` 下分别为 887 / 1347 个洪涝像元，可用于验证改动没有引入偏差。

### 9.2 输出列

**样本 CSV（`SAMPLE_SELECTORS`）**：`event_id, year, storm_start_bj, storm_end_bj, area, label, conf_flood, conf_nonflood, VV, VH, VV_diff, VH_diff, VV_ratio, NDVI, MNDWI, DEM, slope, S2_Valid`
（`VV`/`VH`/`VV_ratio` 是原始绝对后向散射；`VV_diff`/`VH_diff` 是背景参考化后的变化量）

**汇总 CSV（`SUMMARY_SELECTORS`）**：事件与窗口信息、S1/S2 计数与来源、各类像元数、`s1_valid_cover`、`vv_offset_db`、`vh_offset_db`、`debias_mode`、`offset_spread_db`、`n_flood_at_m35`、`n_flood_at_m45`、`flood_sens_ratio`、`sample_count`、`status`

### 9.3 诊断开关打开时会多做什么

- 逐景偏移一览、5 档阈值敏感性全表、参考期基线检验（每个事件多若干 `reduceRegion`）
- 3 个地图图层（洪涝-不去偏 / 去偏 / 去偏新增）；三层是包含关系，**一次只开一层看**，且需 zoom 到 12 级以上

---

## 10. 附：过程中形成的两个"教训"

1. **GEE 影像算术会丢属性**（`system:time_start` 也会丢）。凡是要在生产影像上读时间/轨道等属性，必须在运算后显式 `.set()` 带过去。
2. **`Export.table.toDrive` 不写 `selectors` 时列序不可靠**：表头与取值可能不一一对应（曾出现 `conf_nonflood` 列里全是事件名、`slope` 列里全是日期）。固定 `selectors` 既保证列序，也让 CSV 可追溯。
