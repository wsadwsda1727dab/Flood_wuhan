# 武汉洪涝伪标签项目 · 项目总览

> 本文档由只读分析生成，仅依据项目目录（`D:\User\Documents\ChatGPT\c2`）内的文件推断，未联网、未引入项目外信息。
> 凡无法由项目内文件证实的结论，均在文中标注「未确认」。
> 生成范围约束：除本文档外，未修改、删除、移动或重命名任何现有文件。

---

## 1. 项目名称与一句话简介

**项目名称**：武汉 2016–2025 年暴雨洪涝事件伪标签生成与精度验证（Wuhan Flood Pseudo-Label）

**一句话简介**：在 Google Earth Engine 上用 Sentinel-1 变化检测 + Sentinel-2 光学证据，为武汉市 2016–2025 年的 18 场暴雨洪涝事件生成洪涝伪标签与分层随机森林训练样本，并通过人工目视判读对伪标签做独立精度验证。

> 依据：`AGENTS.md`（项目速览）、`code/temp_version_notes.md` 第 1 节「目标与范围」、`weeklyReport/伪标签精度验证.md:1-30`（研究流程定位）。

---

## 2. 项目类型与技术栈

| 维度 | 内容 | 来源 |
| --- | --- | --- |
| 项目类型 | 遥感科研脚本仓库（数据生产 + 精度验证），非软件工程项目 | `AGENTS.md`、`code/temp_version_notes.md` |
| 主语言 1 | JavaScript（**Google Earth Engine Code Editor 脚本**，依赖 `ee.*` / `Map.*` / `ui.*` / `Export.*`，本地 `node xxx.js` 跑不起来） | `AGENTS.md:13`、`code_accuraccy/validation_review_说明.md:17` |
| 主语言 2 | Python（本地精度报告，**仅用标准库**，明确不引入 pandas / numpy） | `code_accuraccy/validation_accuracy_report.py:1-28`、`AGENTS.md:31` |
| 运行平台 | Google Earth Engine Code Editor（浏览器）；Python 本地命令行 | `code_accuraccy/validation_review_说明.md:223-234` |
| 遥感数据源 | `COPERNICUS/S1_GRD`（IW，VV+VH）、`COPERNICUS/S2_SR_HARMONIZED`（L2A 优先）、`COPERNICUS/S2_HARMONIZED`（L1C 回退）、`USGS/SRTMGL1_003`、`JRC/GSW1_4/GlobalSurfaceWater` | `code/pseudo_labels1.js:611-663, 972-980` |
| 研究区资产 | `projects/studied-glow-475306-v5/assets/wuhan`（代码内硬编码） | `code/pseudo_labels1.js:3` |
| 包管理器 | **未发现**（无 `package.json` / `requirements.txt` / `pyproject.toml` / `Cargo.toml` / `go.mod`） | 全目录检索，见第 9 节 |
| 版本控制 | Git（含 `.gitattributes`、`.gitignore`；`doc/`、`weeklyReport/`、`csvdata/`、`AGENTS.md` 被忽略） | `.gitignore`、`.gitattributes` |
| 行尾/编码约定 | UTF-8 无 BOM；提交规范 LF，但工作区 JS 实际为 CRLF，要求不改动现有行尾 | `AGENTS.md:52-53`、`.gitattributes:1-3` |
| 输出数据格式 | CSV（GEE 导出到 Google Drive；本地脚本可另出 Markdown / CSV 报告） | `code/pseudo_labels1.js:1504-1535`、`code_accuraccy/validation_accuracy_report.py:599-656` |

**未发现**：无 Dockerfile、无 CI 配置（无 `.github/workflows` 等）、无构建脚本、无测试框架。

---

## 3. 目录结构说明

```text
c2/                                  ← 项目根目录（已确认）
├── AGENTS.md                        ← 仓库工作约定（被 .gitignore 忽略）
├── .gitignore / .gitattributes
├── PROJECT_OVERVIEW.md              ← 本文档（本次新建）
│
├── code/                            ← 第 1 阶段：伪标签生成（GEE 脚本）
│   ├── pseudo_labels1.js            ← **当前主版本**（1535 行）
│   ├── temp.original.js             ← 历史存档：最初单事件版本
│   ├── temp.js                      ← 历史存档：19 事件版
│   ├── temp1.1.js ~ temp1.5.js      ← 历史存档：5 个中间版本
│   ├── temp_version_notes.md        ← 版本演进与诊断记录（11 章，改动编号到【改动41】）
│   └── rivision.md                  ← S1/S2 后时相窗口分离修改建议（改动24 的来源）
│
├── code_accuraccy/                  ← 第 2 阶段：精度验证（注：目录名拼写如此，不改名）
│   ├── validation_points.js         ← 生成候选验证点（第一阶段，1527 行）
│   ├── validation_review.js         ← 目视判读台 + Reference 录入 + 导出（第二阶段，2153 行）
│   ├── validation_review_说明.md    ← 判读台说明文档（含参数总表、导出列、已知限制）
│   ├── 阈值合理性与精度评价流程.md  ← 阈值标定到独立验证的 6 步闭环链路
│   └── validation_accuracy_report.py ← 本地精度报告（纯标准库，660 行）
│
├── csvdata/                         ← GEE 导出的 CSV（被 git 忽略，删了不可恢复）
│   ├── pseudo_labels/               ← 汇总表 Summary ~ Summary11 + 4 份分析文档
│   └── validation_points/           ← 判读结果 CSV + 数据核查文档
│
├── doc/                             ← 事件表来源与判读台说明（被 git 忽略）
│   ├── 2016_2025.docx               ← **事件表原始来源**（18/19 场暴雨时段）
│   ├── 001.docx / console.docx / console1.1.docx
│   ├── labelConsole1.md / labelConsole2.md      ← 两轮 Console 输出存档
│   └── 数据说明附录_Wuhan洪涝伪标签_Summary10.md ← 字段字典（41 列 + 样本 18 列）
│
└── weeklyReport/                    ← 周报与实验记录（Obsidian 库，被 git 忽略）
    ├── 20260920.md / 20260927.md
    ├── 伪标签精度验证.md            ← 验证总体方案（31 节）
    ├── 跑者数据与伤病关联分析报告.md ← 与本项目主题无关的文件
    └── .obsidian/                   ← Obsidian 配置与 docx-exporter 插件
```

**文件规模（本次统计）**：约 60 个文件；其中 GEE 脚本 8 个（`code/` 7 个 + `code_accuraccy/` 2 个，含历史存档）、Python 脚本 1 个、Markdown 文档 20 个、CSV 数据 13 个、docx 5 个。

---

## 4. 主要功能与模块

项目是一条**三步主流水线**，外加历史存档与配套分析文档。

### 4.1 模块 A：伪标签生成（`code/pseudo_labels1.js`）

**输入**：事件表（内嵌 `EVENTS` 数组，源自 `doc/2016_2025.docx`）+ GEE 影像集合。
**输出**：样本 CSV（合并 1 份 + 每事件 1 份）、每事件汇总 CSV。

核心处理链路：

| 步骤 | 内容 | 关键参数 |
| --- | --- | --- |
| ① 窗口推导 | 事件时间（北京时）→ UTC；前窗 = 事件开始 −5 天 再往前 24 天；S1 后窗 = 事件结束 ~ +18 天；S2 后窗 = 事件结束 ~ +18 天（个别事件手工截断/加长） | `PRE_WINDOW_DAYS=24`、`PRE_GAP_DAYS=5`、`S1_POST_PAD_DAYS=18`、`S2_POST_PAD_DAYS=18`、`TZ_OFFSET_HOURS=8` |
| ② S1 前时相 | `filterBounds` + IW + VV/VH → `dropFill` 去切片填充值 → `median()` 作基线 | `S1_FILL_DB=-50` |
| ③ S1 后时相 | 取「事件后最早一景 + 8 天」→ `dropFill` → **逐景去偏** → `median()` | `DEBIAS_MODE='perImage'` |
| ④ 变化特征 | `VV_diff` / `VH_diff`（去偏后差值）、`VV_ratio`（原始绝对后向散射，保持物理可解释） | — |
| ⑤ SAR 洪水候选 | 6 条件：相对下降 + 事件前非水 + 事件后为水，再叠加 `s1Valid` | `-4.0 / -3.5 / -15 / -20 / -16 / -22` dB |
| ⑥ 光学证据 | 逐景算 `NDVI` / `MNDWI` → 时间维取 `max`；`S2_Valid` 恒取「窗口内至少一次有效观测」 | `S2_INDEX_STAT='max'`、`MNDWI_THRESHOLD=0.2`、`S2_CLOUD_MASK='QA60'`、`S2_MAX_CLOUD=90` |
| ⑦ 辅助约束 | SRTM DEM / 坡度、JRC 永久水体 | `SLOPE_LIMIT=5`（度）、`PERMANENT_WATER_TH=90`（%） |
| ⑧ 伪标签分级 | High Flood = 候选 ∧ 光学水 ∧ 非永久水 ∧ 低坡度；Medium Flood = 候选 ∧ 无 S2 ∧ 非永久水 ∧ 低坡度；Non-Flood 同理（SAR 稳定区 ±1.5 dB，与洪水类互斥，冲突时优先洪水） | `STABLE_TOLERANCE=1.5` |
| ⑨ 分层抽样 | `stratifiedSample` 按 `label` 分正负两类各取 `min(2000, 该类像元数)`，100 m 尺度，固定种子 | `SAMPLE_SCALE=100`、`POINTS_PER_CLASS=2000`、`SAMPLE_SEED=42` |
| ⑩ 质控与诊断 | 自动打 `s2_qc_flag`（`OK`/`LOW_S2_COVER`/`NO_OPTICAL`）；启动时跑 S2 后窗越界自检；可选的越界尾段诊断 | `LOW_S2_COVER_MIN=0.5`、`MIN_HIGH_FLOOD_SHARE=0.3`、`NO_OPTICAL_COVER=0.05`、`S2_TAIL_DIAG=true` |
| ⑪ 导出 | 合并样本 CSV + 每事件样本 CSV + 汇总 CSV，固定 `selectors` 保证列序 | `EXPORT_ALL/EXPORT_PER_EVENT/EXPORT_SUMMARY = true` |

**标签语义**（务必写进论文口径）：**「事件结束（暴雨时段终点）后 18 天内水体的峰值并集」**（`doc/数据说明附录_Wuhan洪涝伪标签_Summary10.md:12`）。

**重要工程细节**（已在项目文档中被反复强调）：
- GEE 影像算术（如 `subtract`）会丢失影像属性（连 `system:time_start` 一起丢），需要显式 `.set()` 带过去（`code/temp_version_notes.md` 第 10 节「附：过程中形成的两个"教训"」第 1 条）。
- `Export.table.toDrive` 不写 `selectors` 时列序不可靠，历史上出现过表头与取值错位（`code/temp_version_notes.md` 第 10 节「附：过程中形成的两个"教训"」第 2 条）。
- Sentinel-1 GRD 切片填充值是很大的负值（不是 0），`mask()` 看不见，必须用 `dropFill` 显式掩掉（`code/pseudo_labels1.js:89-91, 500-505`）。

### 4.2 模块 B：验证点生成与目视判读（`code_accuraccy/`）

| 文件 | 角色 | 要点 |
| --- | --- | --- |
| `validation_points.js` | 第一阶段：生成并导出候选验证点 | 复用伪标签生成流程，`POINTS_PER_CLASS=300`、`SAMPLE_SEED=20260927`、`SAMPLE_SCALE=100`（与训练样本用不同种子） |
| `validation_review.js` | 第二阶段：目视判读工作台 | 自带一份标签生成代码；关闭全部伪标签导出；移除伪标签图层；提供判读面板与 Reference/confidence 录入；导出的 CSV 交本地脚本算指标 |
| `validation_accuracy_report.py` | 本地精度计算 | 读判读 CSV → 输出 6 节报告：数据概况 / 主精度表（含 Wilson 95% CI）/ 分档精度 / 面积加权 OA / 判读置信度分层 / 误差剖析 + 自动提示 |

**判读台的三个关键设计**（`code_accuraccy/validation_review_说明.md`）：
1. **盲判**：默认 `REVIEW_HIDE_PSEUDO = true`，不显示伪标签、分层与置信度，避免开卷偏差。
2. **五层分层抽样**（【改动34】）：`非洪涝 / High Flood / Medium Flood / 版本差异·事件前已是水 / 版本差异·前非水但后不够暗`，每层上限 `20/20/20/40/40`（合计 ≤140 点/场）。第 3、4 层是判断阈值松紧的关键——**这类「被新约束删掉」的像元在训练样本里根本不存在，必须单独抽**。
3. **按事件留出 tune / valid**：`VALIDATION_EVENT_NAMES` 5 场作独立验证集（`2016_0630`、`2017_0824`、`2021_0823`、`2023_0719`、`2025_0607`），其余为调参集；`2020_0705` 故意留在调参集（第一轮已判读的 401 点会用于调参，同一场不能再当独立验证）。

**`validation_accuracy_report.py` 的报告章节**：0 数据概况 → 1 主精度表（逐事件 + 合计，OA/Precision/Recall/Specificity/F1/Kappa + Wilson 95% CI）→ 2 分档精度表（High / Medium）→ 3 面积加权 OA → 4 人工判读置信度分层 → 5 误差剖析（四象限特征均值 + FP/FN 明细）→ 6 自动提示。

### 4.3 分析文档模块（非代码，但对理解口径必需）

| 文档 | 作用 |
| --- | --- |
| `code/temp_version_notes.md` | 版本演进（改动 1→41、【改动41】为最新一条）、全局参数表（含 4.1 判读台侧参数）、诊断工具箱、22 条已验证结论、已知问题与待办 |
| `csvdata/pseudo_labels/事件筛查与训练集划分{,1,2}.md` | 三代 A/B/C 事件筛查与训练/验证划分建议（v1 基线 / v1.1 Summary10 / v2 Summary11） |
| `csvdata/pseudo_labels/S2后窗与光学口径调整总结.md` | 把「代码改了什么」与「汇总表变了什么」放一起，供论文方法部分引用 |
| `csvdata/validation_points/伪标签精度验证_数据核查.md` | 2020_0705 事件 401 点的数据特征、方法与精度结果（OA 0.875、Kappa 0.750） |
| `code_accuraccy/阈值合理性与精度评价流程.md` | 阈值标定 6 步闭环链路与 6 条关键原则 |
| `doc/数据说明附录_Wuhan洪涝伪标签_Summary10.md` | 汇总表 41 列 + 样本表 18 列字段字典，以及「最容易踩的六个坑」 |

### 4.4 历史存档

`code/temp.original.js`、`code/temp.js`、`code/temp1.1.js` ~ `code/temp1.5.js` 共 7 个历史版本，**只作对照，不再改动**（`AGENTS.md:20`）。演进脉络：单事件 → 19 事件 → 后窗语义修正 → 后时相覆盖修复 → 填充值/去偏/QC → 逐景去偏 → 诊断收敛 → `pseudo_labels1.js`。

---

## 5. 关键文件与入口

| 类型 | 文件 | 说明 |
| --- | --- | --- |
| **主入口（生产）** | `code/pseudo_labels1.js` | 唯一当前主版本；在 GEE Code Editor 中 Run 即开始逐事件处理 |
| **验证入口 1** | `code_accuraccy/validation_points.js` | 生成候选验证点并导出 CSV |
| **验证入口 2** | `code_accuraccy/validation_review.js` | 浏览器内逐点盲判 + 录入 reference/confidence + 导出判读 CSV |
| **报告入口** | `code_accuraccy/validation_accuracy_report.py` | `python code_accuraccy/validation_accuracy_report.py` |
| 事件定义 | `code/pseudo_labels1.js` 中的 `EVENTS` 数组（第 186–433 行） | 20 条 = 18 场暴雨 + 2 场「零暴雨」对照（`isControl`，默认不跑） |
| 汇总表列定义 | `SUMMARY_SELECTORS`（`code/pseudo_labels1.js:144-165`） | 41 列 |
| 样本表列定义 | `SAMPLE_SELECTORS`（`code/pseudo_labels1.js:131-136`） | 18 列 |
| 事件表原始来源 | `doc/2016_2025.docx` | 暴雨时段起止、影响区、雨量（二进制 Word 文档，本次仅确认存在与用途，未解析内容） |

**脚本加载时自动执行的自检**：`reportS2WindowOverlaps()`（`code/pseudo_labels1.js:1393-1414`）——纯 JS、不连 GEE，两两比对所有暴雨事件，凡「后一场暴雨起点落在本场 S2 后窗之内」就报警。设计动机：手工截断会漏（历史上 `2025_0522` 越界 2.7 天长期无人察觉）。

**运行范围开关**：`RUN_EVENT_NAMES = null` 表示全量 18 场暴雨；也可写成数组点名某几场。`EVENTS_TO_RUN` 会自动过滤掉 `isControl` 对照事件（`code/pseudo_labels1.js:1418-1429`）。

---

## 6. 安装与运行方式（仅根据项目内文件推断）

### 6.1 前置条件

| 项 | 要求 | 来源 |
| --- | --- | --- |
| Google Earth Engine 账号 | 需有权访问研究区资产 `projects/studied-glow-475306-v5/assets/wuhan` | `code/pseudo_labels1.js:3` |
| 浏览器 | 使用 GEE Code Editor（脚本依赖 `ui.*` / `Map.*`，本地无法运行） | `code_accuraccy/validation_review_说明.md:17` |
| Python | 运行本地精度报告；**只依赖标准库**（`argparse` / `csv` / `math` / `sys` / `unicodedata` / `collections` / `pathlib` / `statistics`） | `code_accuraccy/validation_accuracy_report.py:30-44` |
| 依赖安装 | **项目内没有任何依赖清单文件，也未发现需要 `pip install` 的说明** | 见第 9 节 |

### 6.2 运行伪标签生成（GEE）

1. 在 GEE Code Editor 打开 `code/pseudo_labels1.js`，点 **Run**。
2. 检查 Console：每场会打印暴雨时段、前/后窗口、数据可用性、S2 数据源、S2 云掩膜口径、像元统计、样本数；异常会打印 `⚠` 警告。
3. 导出需在 **Tasks 面板点 RUN** 才真正执行。
4. 产出 3 类 CSV：`Wuhan_2016_2025_Flood_PseudoLabel_All`（合并样本）、`Flood_<事件名>`（每事件样本）、`Wuhan_2016_2025_Flood_Event_Summary`（每事件汇总）。

> 来源：`code/pseudo_labels1.js:1446-1535`、`AGENTS.md:30`。

### 6.3 运行目视判读（GEE）

1. Run `code_accuraccy/validation_review.js`；Console 打印每场判读分层像元数、「判读事件与候选点数」、「按事件留出：valid = … tune = …」。
2. 面板选事件 → 上一页/下一页/跳转移动点位（当前点红圈高亮到 15 级）。
3. 判读 **Flood (1) / Non-Flood (0) / Uncertain (-1)** 并选 `confidence`（2 高可信 / 1 一般可信 / 0 无法判断），记录后自动跳下一点；点错可「撤销上一点」。
4. 判读完点「导出判读结果 CSV」，再到 Tasks 面板点 RUN 导出到 Drive；同时可「打印已判 JSON」留备份。

> **重要限制**：Code Editor 每次 Run 都会重置脚本状态，判读结果只存在内存里 —— 必须在一次会话内判完并导出；判不完按事件分批（用 `RUN_EVENT_NAMES` 点名几场）。来源：`code_accuraccy/validation_review_说明.md:223-234`、`code_accuraccy/validation_review.js:1392-1394`。

### 6.4 运行本地精度报告（Python）

```bash
# 用脚本内置默认路径
python code_accuraccy/validation_accuracy_report.py

# 多文件（多事件）/ 目录下所有 CSV
python code_accuraccy/validation_accuracy_report.py a.csv b.csv
python code_accuraccy/validation_accuracy_report.py <目录>

# 落盘 Markdown 报告与指标 CSV，并调整 FP/FN 明细条数
python code_accuraccy/validation_accuracy_report.py --md report.md --out-csv metrics.csv --detail 40

# 剔除 confidence=0（无法判断）的点
python code_accuraccy/validation_accuracy_report.py --drop-conf0
```

> 来源：`code_accuraccy/validation_accuracy_report.py:20-27, 599-656`、`AGENTS.md:31`。
> **注意**：脚本内默认输入是**硬编码绝对路径** `D:\User\Documents\ChatGPT\c2\csvdata\validation_points\Wuhan_validation_reference_20200705.csv`，换机器需用参数传入（`code_accuraccy/validation_accuracy_report.py:49-51`）。

---

## 7. 配置与环境变量

### 7.1 敏感信息与密钥

**未发现**任何 `.env`、密钥、token、密码或凭据文件。全目录检索的文件类型只有 `.js` / `.py` / `.md` / `.csv` / `.docx` / `.json` / `.css` / `.gitignore` / `.gitattributes`。

- **存在 GEE 项目 ID / 资产路径**（非密钥，属资源标识）：`projects/studied-glow-475306-v5/assets/wuhan`（`code/pseudo_labels1.js:3`）。
- **未发现**任何环境变量读取（无 `process.env` / `os.environ` / `getenv`）。
- `.obsidian/` 下的 `app.json` / `appearance.json` / `workspace.json` 等为本地编辑器状态配置，**本次未逐项读取其内容**（与本项目分析无关）。

### 7.2 代码内配置项（非环境变量，均为脚本顶部全局参数）

**判识阈值**

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `VV_THRESHOLD` | −4.0 dB | VV 后−前 下降阈值 |
| `VH_THRESHOLD` | −3.5 dB | VH 后−前 下降阈值 |
| `MNDWI_THRESHOLD` | 0.2 | 光学水体阈值 |
| `SLOPE_LIMIT` | 5° | 低坡度阈值 |
| `STABLE_TOLERANCE` | 1.5 dB | SAR 稳定区容差 |
| `PERMANENT_WATER_TH` | 90 % | JRC occurrence 永久水体阈值 |
| `S2_MAX_CLOUD` | 90 % | S2 整景云量上限 |
| `VV_PRE_NONWATER_TH` / `VH_PRE_NONWATER_TH` | −15 / −20 dB | 【改动34】事件前非水（**需按本区重新标定**） |
| `VV_POST_WATER_TH` / `VH_POST_WATER_TH` | −16 / −22 dB | 【改动34】事件后为水（**需按本区重新标定**） |

**窗口与合成口径**

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `PRE_WINDOW_DAYS` / `PRE_GAP_DAYS` | 24 / 5 天 | 事件前基线窗口长度 / 与事件开始的间隔 |
| `S1_POST_PAD_DAYS` | 18 天 | S1 后时相**搜索**窗口（实际合成 = 最早一景 + 8 天） |
| `S2_POST_PAD_DAYS` | 18 天 | S2 后时相窗口 |
| `S2_INDEX_STAT` | `'max'` | 逐景算指数后取时间维 max（备选 `'median'`） |
| `S2_CLOUD_MASK` | `'QA60'` | 云掩膜口径（备选 `'SCL_AND_QA60'`，需 L2A 有 SCL） |
| `DEBIAS_MODE` | `'perImage'` | 逐景扣各自相对前窗基线的偏移 |
| `S1_FILL_DB` | −50 dB | GRD 切片填充值判定阈值 |
| `TZ_OFFSET_HOURS` | 8 | 北京时 → UTC |

**抽样与质控**

| 参数 | 值 | 含义 |
| --- | --- | --- |
| `SAMPLE_SCALE` | 100 m | 抽样与统计尺度 |
| `POINTS_PER_CLASS` | 2000（主脚本）/ 300（验证点）/ 200（判读台） | 每类抽样上限 |
| `SAMPLE_SEED` | 42（训练）/ 20260927（验证） | 抽样随机种子 |
| `LOW_S2_COVER_MIN` / `MIN_HIGH_FLOOD_SHARE` / `NO_OPTICAL_COVER` | 0.5 / 0.3 / 0.05 | `s2_qc_flag` 三档判定 |

**运行开关**

| 参数 | 当前值 | 含义 |
| --- | --- | --- |
| `RUN_EVENT_NAMES` | `null`（主脚本）/ 三场数组（判读台） | 全量 18 场 / 只跑指定事件 |
| `DIAG` | `false` | 诊断输出（逐景偏移、5 档阈值敏感性、目视图层）；全量跑必须保持 false |
| `S2_TAIL_DIAG` | `true` | 越界尾段晴空贡献诊断（仅命中事件打印） |
| `VIEW_EVENT_NAME` | `'Wuhan_2020_0705'` | Map 上显示哪一场（必须是字符串，不能是数组） |
| `EXPORT_ALL / EXPORT_PER_EVENT / EXPORT_SUMMARY` | `true`（主脚本）/ `false`（判读台） | 导出开关 |

> 来源：`code/pseudo_labels1.js:10-128`、`code/temp_version_notes.md` 第 4 节「全局参数表（pseudo_labels1）」、`code_accuraccy/validation_review_说明.md:151-202`。

### 7.3 单场窗口特例（事件表内的逐事件覆盖）

| 事件 | 覆盖项 | 原因 |
| --- | --- | --- |
| `Wuhan_2016_0630` | `preStart/preEnd`、`postStart/postEnd` | 沿用早期已跑通的窗口（`postEnd` 现只作用于 S1） |
| `Wuhan_2018_0518` 等 | 使用默认窗口推导 | — |
| `Wuhan_2017_0824` | `s2Source: 'L1C'` | 窗口内个别 L2A 景会把整场拖到另一套辐射口径，导致覆盖 98.0% → 1.3% |
| `Wuhan_2020_0628` | `s2PostEnd: '2020-07-05 00:00'`（≈5.5 天） | 躲避下一场暴雨 `2020_0705`，防止 max 把后一场的水并进本场 |
| `Wuhan_2020_0705` | `preStart/preEnd` 前移 | 6/28–29 刚下过暴雨，避免把上一场洪水当背景 |
| `Wuhan_2024_0621_0628` | 合并场；`s2PostEnd: '2024-07-16 00:00'`（24 天） | 两场相隔 7 天，独立处理会导致重复打标或标签退化 |
| `Wuhan_2025_0522` | `s2PostEnd: '2025-06-07 00:00'`（18→15 天） | 尾段只贡献 0.6% 晴空像元，可安全截断 |
| `Wuhan_2025_0607` | `preStart/preEnd` 前移 | 5/22 刚下过暴雨 |

来源：`code/pseudo_labels1.js:186-433`。

---

## 8. 测试、构建与部署

| 项 | 现状 | 来源 |
| --- | --- | --- |
| 单元测试 / 测试框架 | **不存在**（无测试目录、无测试文件、无测试框架配置） | 全目录检索 |
| CI / CD | **不存在**（无 `.github/`、无 `.gitlab-ci.yml`、无 Jenkinsfile 等） | 全目录检索 |
| 构建步骤 | **无**（GEE 脚本在浏览器内直接执行；Python 脚本标准库直跑） | — |
| 语法检查 | 项目文档提到 JS 改动会做 `node --check` 静态检查 | `code/temp_version_notes.md` 第 5 节【改动N】小节的「静态校验」段、`code_accuraccy/validation_review_说明.md:265` |
| 部署 | 无需部署；产出物是 Google Drive 上的 CSV 与 `csvdata/` 下的本地 CSV | `code/pseudo_labels1.js:1498-1535` |
| 质量保证机制（替代测试） | ① 脚本加载时自动跑越界自检；② 每事件自动打 `s2_qc_flag`；③ `DIAG=true` 时输出逐景偏移 / 阈值敏感性 / 参考期基线 / 目视图层；④ 要求口径类改动必须重跑并逐字段比对 Summary 表 | `code/pseudo_labels1.js:1393-1414, 1237-1328`、`AGENTS.md:33` |
| 可复现性 | 抽样种子固定 + 判识流程无随机项 → 同代码重跑得到同一套标签（项目文档记录了多次独立运行互证，差异 ≤6.7e-16） | `code/temp_version_notes.md` 第 7 节结论 21「重跑是确定的」 |

**项目自定的验证纪律**（`AGENTS.md:29-33`）：
- GEE 脚本必须到 Code Editor 实跑，确认无报错且 `print` 输出合理；导出要在 Tasks 面板点 RUN 才真正执行。
- 口径类改动（阈值、时间窗口、抽样参数、云掩膜）**必须重跑并比对 Summary 表，不能只做静态检查**。
- 判读要在浏览器里做，本地 `node xxx.js` 跑不起 GEE 脚本。

---

## 9. 依赖与版本要求

### 9.1 项目内依赖清单

**未发现任何依赖清单文件**——无 `package.json`、`package-lock.json`、`pnpm-lock.yaml`、`requirements.txt`、`pyproject.toml`、`Cargo.toml`、`go.mod`、`environment.yml`。

### 9.2 运行时依赖（由代码内容推断）

| 运行环境 | 依赖 | 说明 |
| --- | --- | --- |
| Google Earth Engine Code Editor | `ee`、`Map`、`ui`、`Export`、`print` 全局对象 | 由 GEE 平台提供，无需本地安装 |
| Python | **仅标准库**：`argparse`、`csv`、`math`、`sys`、`unicodedata`、`collections`、`pathlib`、`statistics` | `code_accuraccy/validation_accuracy_report.py:30-44`；`AGENTS.md:31` 明确「只依赖标准库，不要引入 pandas / numpy」 |
| Python 版本 | 代码使用 `from __future__ import annotations`、`list[Point]` 内建泛型标注 → **要求 Python ≥ 3.9**（标注为推断，**未确认**项目实际使用的版本） | `code_accuraccy/validation_accuracy_report.py:30, 172` |
| 本地可选工具 | `node --check` 仅用于 JS 语法静态检查 | `code/temp_version_notes.md` 第 5 节【改动N】小节的「静态校验」段 |
| Obsidian | `weeklyReport/` 为 Obsidian 库，含 `docx-exporter` 社区插件（`manifest.json` / `main.js`） | `weeklyReport/.obsidian/community-plugins.json`、`weeklyReport/.obsidian/plugins/docx-exporter/` |

### 9.3 GEE 平台数据依赖版本（代码内固定）

| 数据集 | 版本标识 | 位置 |
| --- | --- | --- |
| Sentinel-1 GRD | `COPERNICUS/S1_GRD` | `code/pseudo_labels1.js:611` |
| Sentinel-2 SR Harmonized | `COPERNICUS/S2_SR_HARMONIZED` | `code/pseudo_labels1.js:662` |
| Sentinel-2 Harmonized（L1C） | `COPERNICUS/S2_HARMONIZED` | `code/pseudo_labels1.js:663` |
| SRTM DEM | `USGS/SRTMGL1_003` | `code/pseudo_labels1.js:972` |
| JRC 全球地表水 | `JRC/GSW1_4/GlobalSurfaceWater` | `code/pseudo_labels1.js:976` |
| 武汉研究区资产 | `projects/studied-glow-475306-v5/assets/wuhan` | `code/pseudo_labels1.js:3` |

---

## 10. 数据产物（`csvdata/`）

### 10.1 伪标签汇总表系列

| 文件 | 事件数 | 列数 | 口径 |
| --- | --- | --- | --- |
| `Wuhan_2016_2025_Flood_Event_Summary.csv` | 19 | 34 | 基线：`temp1.5.js`，18 天 + 波段级 median + QA60 |
| `...Summary1.csv` ~ `...Summary7.csv` | 5（`Summary7` 亦 5） | 递增 | 六轮 S2 窗口/统计量/云掩膜对照 + 1 轮 median 配对 |
| `...Summary8.csv` | 19 | 37 | 改动26 修复后全量（新增 4 个质控列的前身） |
| `...Summary9.csv` | 18 | 41 | 改动28/29/30 落地后全量，`NO_OPTICAL` 清零 |
| `...Summary10.csv` | 18 | 41 | `Summary9` + 截断后的 `2025_0522` |
| `...Summary11.csv` | 18 | 41 | 改动34 落地后全量（S1 预/后向散射约束），18 场面积全部下降 |

> **口径警告**：不同 Summary 的行数与列数都不同（34/37/41 列，19/18 行），**不能直接 concat**。跨版本比较前必须先对齐四项口径：`s2_post_days`、`s2_index_stat`、`S2_CLOUD_MASK`、`s2_source`（`doc/数据说明附录_Wuhan洪涝伪标签_Summary10.md:5`）。

### 10.2 验证点

`csvdata/validation_points/Wuhan_validation_reference_20200705.csv`：401 行（19 列），`event_id` 全部为 `Wuhan_2020_0705`；`reference` 分布 −1:1 / 0:219 / 1:181；`confidence` 分布 2:334 / 1:67 / 0:0（`csvdata/validation_points/伪标签精度验证_数据核查.md:61-65`）。

### 10.3 该事件的已得精度结果（2020_0705，N=400）

| 指标 | 值 |
| --- | --- |
| TP / FP / FN / TN | 166 / 35 / 15 / 184 |
| OA | 0.8750（面积加权 0.8426） |
| Precision / Recall | 0.8259 / 0.9171 |
| F1 / Kappa | 0.8691 / 0.7501 |

> 来源：`csvdata/validation_points/伪标签精度验证_数据核查.md:183-198`。主要误差机制：35 个 FP 中 33 个「事件前本来就是水面」（鱼塘/河湖/常年积水），15 个 FN 属「植被下洪水 / 弱变化洪水 / 洪水已退」。

---

## 11. 已知限制与待确认项

### 11.1 项目文档明确记录的已知限制

| 级别 | 事项 | 来源 |
| --- | --- | --- |
| 必须 | `validation_review.js` 当前版本**未在 GEE 实跑**，只做了 `node --check` 静态检查；因涉及阈值口径，必须在 Code Editor Run 并核对 Console 分层像元数 | `code_accuraccy/validation_review_说明.md:282` |
| 必须 | `validation_accuracy_report.py` 对 `new_label = -1`（掩膜未定）的点会**静默排除**，尚未显式单列统计；这些点既不能算对也不能算错，使用前需补齐 | `code_accuraccy/validation_review_说明.md:407, 430` |
| 必须 | `flood_sens_ratio` / `n_flood_at_m35` / `n_flood_at_m45` **仍按旧候选规则计算**（不含改动34 的 4 个约束），更新前不能作为新阈值的稳定性依据 | `code_accuraccy/validation_review_说明.md:209, 431`、`csvdata/pseudo_labels/事件筛查与训练集划分2.md:54` |
| 必须 | 【改动34】的 4 个 dB 阈值只是 IW GRD **参考初值，尚未按本区标定**；标定后需同步回 `code/pseudo_labels1.js` 并重跑得到 `Summary12` | `code_accuraccy/validation_review_说明.md:270`、`code/pseudo_labels1.js:95-98` |
| 高 | 目视核查首轮**未通过**：`2022_0627` / `2023_0618` 的 DIAG 截图显示洪涝像元呈孤立散点、无连片淹没面，且 MNDWI 合成里云多 | `code/temp_version_notes.md` 第 7 节结论 22、第 5 节【改动32】 |
| 高 | 需要新增 `n_sar_cand_px` 列，以区分「S2 把像元挡掉」（可修）与「过境时水已退」（物理限制） | `code/temp_version_notes.md` 第 8 节待办·高「新增 `n_sar_cand_px` 列」 |
| 中 | S2 窗口可能「一景都没有」→ 脚本会在 `s2Idx.select(...)` 处报错终止（既有行为，**未加判空分支**） | `code/temp_version_notes.md` 第 8 节待办·中「S2 窗口可能"一景都没有"」 |
| 中 | 事件定义待回查：`Wuhan_2025_0607` 的雨量注记写的是「6 月 21 日数据」，而事件窗口是 6 月 7–9 日；`Wuhan_2017_0608` 的 `rain_ref_mm` 为空 | `code/temp_version_notes.md` 第 8 节待办·中「事件定义回查」 |
| 中 | `2016_0601` 是唯一 C 类（`s1_valid_cover=0.469`）；**单纯延长 `postEnd` 无效**，因为 S1 后时相合成是「最早一景 + 8 天」 | `code/temp_version_notes.md` 第 8 节待办·低「修覆盖不足事件」 |
| 中 | 分类不平衡：少量事件正类仅 200~500 像元，合并训练需按事件配额或分层加权 | `code/temp_version_notes.md` 第 8 节待办·中「分类不平衡处理」 |
| 注意 | 判读点开销：当前跑三场，上限 3 × 140 = 420 点（实际更少）；扩到全量 18 场最多 2520 点 | `code_accuraccy/validation_review_说明.md:432` |
| 注意 | 若 `stratifiedSample` 报某层点数不足，需把 `REVIEW_POINTS_PER_STRATUM` 对应层上限调低 | `code_accuraccy/validation_review_说明.md:433` |
| 方法学 | 验证必须**按事件留出**；同一事件的像元高度空间自相关，随机划分会显著高估精度 | `csvdata/pseudo_labels/事件筛查与训练集划分2.md:216` |
| 方法学 | `Summary10` 与 `Summary11` 的标签定义不同（相对下降规则 vs 事件前非水+事件后为水+相对下降），**不能直接 concat 或混合训练** | `csvdata/pseudo_labels/事件筛查与训练集划分2.md:236` |
| 方法学 | `high_flood_share` 上升 ≠ 标签质量提升（Medium 降幅更大导致占比自然上升，High 绝对像元数同时下降 59.3%） | `csvdata/pseudo_labels/事件筛查与训练集划分2.md:237` |
| 方法学 | 4~32 km²/100mm 是 `Summary10` 口径下的经验带；`Summary11` 中位数已降到 3.96，不能简单下移下界来「恢复」A 类 | `csvdata/pseudo_labels/事件筛查与训练集划分2.md:239` |
| 方法学 | SAR 对淹水稻田同样出现 VV/VH 骤降，「SAR + 光学同时判水」**不能**排除泡田；100% High 不等于质量已确认 | `csvdata/pseudo_labels/事件筛查与训练集划分2.md:240` |
| 结论 | 截至 `Summary11`，项目自身建议**不要直接冻结最终训练/验证划分**；应先重标定 4 个阈值、更新诊断、重跑得到 `Summary12` 再做划分 | `csvdata/pseudo_labels/事件筛查与训练集划分2.md:24` |

### 11.2 本次分析发现的文档-代码/文件不一致（供核对）

| # | 现象 | 本次观察到的证据 |
| --- | --- | --- |
| 1 | 代码引用了**不存在的输入文件** | `code_accuraccy/validation_accuracy_report.py:51` 定义 `SUMMARY_CSV = BASE_DIR / "Wuhan_2016_2025_validation_points_Summary.csv"`，但 `csvdata/validation_points/` 下**没有这个文件**。脚本对此有兜底（`AREA_FALLBACK` 内置表 + `try/except` 打印 warn），因此面积加权 OA 会退回到仅 3 个事件的内置权重。 |
| 2 | 文档引用了**不存在的脚本** | `csvdata/validation_points/伪标签精度验证_数据核查.md:18, 172` 提到 `code_accuraccy/validation_accuracy.js`（GEE 端精度计算），但该文件**不在当前目录中**。 |
| 3 | 两个验证脚本的抽样参数不完全一致 | `validation_points.js` 为 `POINTS_PER_CLASS = 300`；`validation_review.js` 的 `POINTS_PER_CLASS`（原 `200`）已随【改动37】移除（`code_accuraccy/validation_review.js:66`），现只按 `REVIEW_POINTS_PER_STRATUM` 分层配额抽样，`REVIEW_POINTS_PER_STRATUM` 合计可达 140 点/场。文档已记录历史成因，但三个数字并存易误读。 |
| 4 | `validation_review_说明.md` 与实际文件内容存在版本差 | 说明文档第 5 节称「判读脚本的旧显示块已移除」，实际 `validation_review.js:1363-1367` 保留了一段被注释说明的 6/7 节（导出开关全为 `false`），属说明性保留，非缺陷。 |
| 5 | 事件条数在文档中并存 18 / 19 / 20 三个数字 | 18 = 当前暴雨事件数；19 = 【改动28】合并前；20 = `EVENTS` 数组总条数（18 暴雨 + 2 对照）。读文档时需注意语境。 |
| 6 | `weeklyReport/跑者数据与伤病关联分析报告.md` 与本项目主题无关 | 该文件位于 `weeklyReport/` 内，主题为跑步与伤病关联分析，**未确认**是否属本仓库的正式内容。 |

### 11.3 本次未能确认的信息

1. **运行环境版本**：实际使用的 Python 版本、浏览器、GEE 账号权限范围——项目内无记录。
2. **`doc/` 下 5 个 .docx 的内容**：本次仅确认 `doc/2016_2025.docx` 是事件表来源（由代码注释与文档记载确认），**未解析二进制内容**；`001.docx`、`console.docx`、`console1.1.docx` 的具体内容未确认。
3. **`doc/labelConsole2.md` 全文**：仅读取了首段（确认是 Console 输出存档），未逐节核对。
4. **git 历史状态**：本次未执行任何 git 命令（属写操作风险区，且任务要求只读）；工作区未提交改动的具体清单未确认。`AGENTS.md:57-58` 提示工作区常有未提交改动。
5. **`Summary11` 之后是否存在 `Summary12`**：项目文档建议产出 `Summary12`，但当前目录**未发现**该文件；是否已在 GEE 侧跑出但未下载，未确认。
6. **判读是否已完成三场**：`validation_review.js` 默认跑三场（`2020_0705` / `2021_0823` / `2023_0618`），但 `csvdata/validation_points/` 下**只有 `2020_0705` 一个判读结果 CSV**，另两场是否已判读、结果在何处，未确认。
7. **`.obsidian/` 各 JSON 配置的内容**：未逐项读取（与本项目技术栈分析无关）。
8. **项目是否计划进入 Random Forest 阶段**：文档描述了后续 RF 训练与独立验证的完整规划（`weeklyReport/伪标签精度验证.md:792-891`），但当前目录**没有任何 RF 训练代码或模型产物**，是否已启动未确认。

---

## 附录 A：三代事件划分结论对照（供快速定位）

| 版本 | 依据数据 | A 类（训练候选） | B 类（仅验证） | C 类（剔除） |
| --- | --- | --- | --- | --- |
| v1.1 | `Summary10` | 11 | 6 | 1 |
| v2（严格口径） | `Summary11` | 5 | 11 | 2 |
| v2（沿用 `2025_0522` 例外） | `Summary11` | 5 | 12 | 1 |

> v2 的 5 场 A 类：`2018_0630` ⚠、`2017_0824` ⚠、`2021_0510`、`2017_0405`、`2020_0705` ★（合计约 1.57 万条样本）。
> 口径：`s2_qc_flag=OK`、`s1_valid_cover≥0.95`、`4≤per100≤32`、`high_flood_share≥0.50`、`offset_spread_db≤1.50`。
> 来源：`csvdata/pseudo_labels/事件筛查与训练集划分2.md:21-25, 135-178`。

## 附录 B：本次分析的只读性说明

- 读取范围：仅 `D:\User\Documents\ChatGPT\c2` 及其子目录；**未读取任何项目外路径**。
- 写入操作：**仅新建本文件** `PROJECT_OVERVIEW.md`；未修改、删除、移动、重命名、覆盖任何现有文件。
- 未执行：安装、构建、测试、运行脚本、git 读写、联网搜索。
- 敏感信息：未发现 `.env` / 密钥 / token / 密码；仅记录「存在 GEE 项目 ID 与资产路径」这一资源标识。
