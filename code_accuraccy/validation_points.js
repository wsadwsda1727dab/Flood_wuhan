
// 0. 研究区
var wuhan = ee.FeatureCollection("projects/studied-glow-475306-v5/assets/wuhan");
var DEFAULT_ROI = wuhan;

Map.centerObject(DEFAULT_ROI, 9);
Map.addLayer(DEFAULT_ROI, {color: 'black'}, 'Wuhan');


// 1. 全局参数
// 判识阈值
var VV_THRESHOLD = -4.0;       // VV 后-前 下降超过 4 dB
var VH_THRESHOLD = -3.5;       // VH 后-前 下降超过 3.5 dB
var MNDWI_THRESHOLD = 0.2;     // 光学水体阈值
var SLOPE_LIMIT = 5;           // 低坡度阈值（度）
var STABLE_TOLERANCE = 1.5;    // SAR 稳定区容差（dB）
var PERMANENT_WATER_TH = 90;   // JRC occurrence 永久水体阈值（%）
var S2_MAX_CLOUD = 90;         // S2 整景云量上限（%）

// ---- 抽样参数 ----
var SAMPLE_SCALE = 100;         // 抽样与统计尺度（m）
var POINTS_PER_CLASS = 300;   // 每类最多抽样点数（实际取 min(该值, 该类像元数)）
var SAMPLE_SEED = 20260927;          // 抽样随机种子

// ---- 正负样本口径 ----
var USE_MEDIUM_AS_FLOOD = true;      // Medium Flood（无 S2 的 SAR 洪水）是否作为正样本
var USE_MEDIUM_NONFLOOD = true;      // Medium Non-Flood 是否作为负样本
var NONFLOOD_REQUIRE_LOWSLOPE = true;// 负样本是否同样要求低坡度（正负物理条件对称）

// ---- 时间窗口推导参数（天）----
var PRE_WINDOW_DAYS = 24;  // 事件前基线窗口长度
var PRE_GAP_DAYS = 5;      // 基线窗口结束 → 事件开始 之间的间隔

// 【改动24】后窗口按传感器拆开（原来 S1/S2 共用一个 POST_PAD_DAYS = 18）
//   Sentinel-1：保持较长的"搜索"窗口，保证重访影像数量足够（12 天重访 + 余量）。
//               注意 18 天只是搜索范围，真正参与后时相合成的是 post8（最早 S1 之后的 8 天）。
//   Sentinel-2：事件结束后 S2_POST_PAD_DAYS 天内的光学观测。
//               洪水消退远快于 SAR 重访，当初担心"后半段影像已经是退水后"会把 MNDWI 拉低。
//   【改动25】实测三档（5 / 10 / 18 天）后发现：真正的问题不是"退水稀释"，而是**云的稀释**——
//     5 天：洪水区常被云盖住，S2 有效覆盖从 ~100% 掉到 0~81%（2021_0823 直接 0%），
//           有光学背书的 High Flood 被大批推成"无 S2"的 Medium Flood，面积虚涨；
//     10 天：覆盖补回大半，但 2020_0705 仍只有 23.6%，对照事件依旧不可用；
//     18 天：覆盖回到 86.5%~100%（与基线一致），配合下面的"逐景算指数再取 max"，
//           四个低面积事件的 High 全部回升（+37%~+752%），而中值口径下被稀释掉的
//           恰恰是短历时暴雨的积水面。→ 故最终定为 18 天，"退水稀释"改由 max 口径解决。
//   注意：标签语义随之变为"事件后 18 天内水体的峰值并集"，窗口一旦定稿不要再改，
//         否则所有面积都会跟着变（实测 2023_0618 仅窗口 10→18 天，面积就从 6.80 涨到 25.26 km²）。
var S1_POST_PAD_DAYS = 18;
var S2_POST_PAD_DAYS = 18;

// ---- 【改动25】S2 光学合成口径 ----
//  旧口径是"先合成波段、再算指数"：
//      var s2 = s2Col.median();
//      var mndwi = s2.normalizedDifference(['B3', 'B11']);
//  这样得到的其实是"由各波段中值拼出来的虚拟景"的指数，不对应任何一天的真实观测。
//  若只把它换成 s2Col.max()，得到的是"由各波段最大值拼出来的虚拟景"的指数：
//      ① 不单调——实测 2021_0823（High 543→496）、2020_0705（126→122）的水体判定反而变少；
//      ② 不可解释——最亮的绿波段与最强的短波红外可能来自不同日期，混出来的像元不存在。
//  现在改为"逐景先算指数 → 再在时间维取统计量"：
//      'max'    = 该像元在窗口内测到的最高水体信号，数学上必然 ≥ 中值口径，
//                 只会让水体判定更宽松、不会更严，MNDWI_THRESHOLD 的含义也清晰（推荐）
//      'median' = 逐景指数取中值，更保守，留作对照/敏感性分析
//  注意：换口径后导出的 MNDWI / NDVI 特征含义随之变化（最大值而非典型值），
//        与改动25 之前那几版样本不能直接混用；summary 里的 s2_index_stat 记录了本次口径。
//  【改动26】S2_Valid 已与 S2_INDEX_STAT 解耦（见 4.5 节）：有效覆盖恒取"窗口内至少一次有效观测"，
//        切到 'median' 时不再顺带收紧覆盖。此前 18 天档的 median 配对（Summary7）就是被这个耦合污染的。
var S2_INDEX_STAT = 'max';

// ---- 【改动27】S2 光学覆盖质控阈值 ----
//  背景：18 天档逐景 max 的全量跑（Summary8）里有两场事件的光学证据几乎为零——
//    2024_0621（S2 后窗被截到 6 天 + 全窗口被云盖）与 2017_0824（S2 源翻到 L2A 后覆盖崩掉）。
//    这两场的 SAR 洪水候选 100% 落进 Medium Flood、High Flood = 0，标签退化成"纯 SAR 推断"，
//    与其他"光学双确认"事件语义不一致，直接混训会污染标签。
//  所以每场跑完自动算两个量并打标记，避免以后再靠人工比对才发现：
//    s2_cover_valid_frac = S2 有效像元 / SAR 有效区像元（>1 表示 S2 覆盖超出 SAR 有效区之外）
//    high_flood_share    = High Flood / (High + Medium Flood)，即正样本的"光学背书纯度"
var LOW_S2_COVER_MIN = 0.5;      // 低于此比例 → LOW_S2_COVER
var MIN_HIGH_FLOOD_SHARE = 0.3;  // 正样本 High 占比低于此值 → LOW_S2_COVER
var NO_OPTICAL_COVER = 0.05;     // 低于此比例 → NO_OPTICAL（基本没有光学证据）

// ---- GRD 切片填充值 ----
//  Sentinel-1 GRD 按 25 秒切片存储，切片范围外的像元填的是很负的 dB 值（不是 0），
//  mask() 看不见它；不掩掉的话 vv_diff 会出现 -30000 dB 级别的假变化。
var S1_FILL_DB = -50;

// ---- 去偏模式（背景参考化）----
//  Sentinel-1 前后时相之间存在与洪水无关的系统性后向散射偏移（土壤湿度/物候/轨道几何）。
//  实测同一事件内 orbit 40 与 orbit 113 的背景偏移可差 ~0.9 dB，只扣一个全局数会在两条
//  轨道覆盖区之间残留 ±0.4 dB 的系统偏差（沿轨道条纹）。三种模式：
//    'none'     不做校正，用绝对阈值（比前窗基线低 4 dB）
//    'global'   整幅扣一个中位数（简单，但两条轨道扣的是同一个数）
//    'perImage' 每一景各自扣掉自己的偏移（推荐，消除轨道条纹）
var DEBIAS_MODE = 'perImage';

// ---- 诊断开关 ----
//  false = 正式出数据（只打每事件的结果行，不额外发请求、不加图层）
//  true  = 复核单个事件时才打开（逐景偏移一览 / 5 档阈值敏感性 / 参考期基线 / 目视图层）
//  注意：打开后每个事件会多跑十余次 reduceRegion 并往 Map 上叠图层，全量跑务必保持 false。
var DIAG = false;

// ---- 【改动31】S2 后窗"越界尾段"诊断开关 ----
//   只对"本场 S2 后窗伸进后面某场暴雨"的事件生效：`2025_0522` 已按诊断截断
//   （尾段只贡献 0.6% 的晴空像元，见 `doc/labelConsole2.md`），所以**当前 0 场命中**；
//   日后只要再出现越界（新的相邻暴雨），它会自动打印，不需要额外操作。
//   打开后每个命中的事件会多跑 1 次 5 波段 reduceRegion，用来回答"截掉重叠尾段会丢多少晴空观测"。
//   其余事件不命中、零额外开销，所以正式全量跑也可以保持 true；不想看时置 false。
var S2_TAIL_DIAG = true;

// ---- 【改动32】S2 云掩膜口径（回答"标签里的水有多少是残云撑起来的"）----
//   'QA60'         ：原口径 —— QA60 bit10（厚云）+ bit11（卷云）都为 0 才算晴空；
//                    L1C 没有 SCL 波段，走 L1C 的事件只能用这一档。
//   'SCL_AND_QA60' ：L2A 有 SCL 波段，额外排除 1 饱和 / 3 云影 / 8 中概率云 / 9 高概率云 /
//                    10 卷云 / 11 雪，并与 QA60 取交集（更严）。
//   用法：同一事件在两种口径下各跑一次，比较 `s2_cover_valid_frac` / `high_flood_share` / 面积——
//        若换成 SCL 后 High 面积塌掉，说明标签是"逐景 max"把残云当水撑起来的。
//   注意：L1C 无 SCL → 走 L1C 的事件自动退回 QA60（Console 会写明）。
var S2_CLOUD_MASK = 'QA60';

// ---- 时区 ----
// 文档里的事件时间是北京时间，GEE 的 filterDate 按 UTC 处理，这里统一换算。
var TZ_OFFSET_HOURS = 8;

// 样本 CSV 的列（顺序即导出后的列顺序）
var SAMPLE_SELECTORS = [
  'event_id', 'year', 'storm_start_bj', 'storm_end_bj', 'area',
  'label', 'conf_flood', 'conf_nonflood',
  'VV', 'VH', 'VV_diff', 'VH_diff', 'VV_ratio',
  'NDVI', 'MNDWI', 'DEM', 'slope', 'S2_Valid'
];
var SUMMARY_SELECTORS = [
  'event_id', 'year', 'storm_start_bj', 'storm_end_bj',
  'pre_window_utc', 'post_window_utc', 'pre_days', 'post_days',
  // 【改动24】S1 / S2 后窗口拆开后各自的窗口信息
  //   post_window_utc / post_days 沿用旧列名，含义收敛为「Sentinel-1 后窗口」（值不变）；
  //   S2 的短窗口单独存两列，便于和 18 天窗口的旧结果横向对照。
  's2_post_window_utc', 's2_post_days',
  // 【改动25】记录本次的光学合成口径（逐景算指数后取 max 还是 median），
  //   否则 max / median / 波段级统计三套结果混在一起就无法区分。
  's2_index_stat',
  'area', 'rain_ref_mm', 'rainfall',
  's1_pre_count', 's1_post_count', 's2_source', 's2_count',
  'n_flood_px', 'n_nonflood_px', 'n_high_flood_px', 'n_medium_flood_px',
  'n_high_nonflood_px', 'n_medium_nonflood_px', 's2_valid_px',
  's1_valid_cover', 'vv_offset_db', 'vh_offset_db',
  'debias_mode',
  'offset_spread_db', 'n_flood_at_m35', 'n_flood_at_m45', 'flood_sens_ratio',
  'flood_area_km2', 'valid_area_km2',
  // 【改动27】S2 光学覆盖质控：覆盖率、正样本 High 占比、以及自动标记
  'n_valid_px', 's2_cover_valid_frac', 'high_flood_share', 's2_qc_flag',
  'sample_count', 'status'
];

// ============================================================================
// 2.【改动1】事件表（数据来自 doc/2016_2025.docx，共 19 个时段）
//   原 temp.js 这里是写死的 4 个变量：
//     var preStart = '2016-05-20'; ... var postEnd = '2016-07-25';
//   现在改成下面的事件表，一个条目 = 文档里的一个暴雨时段。
// ----------------------------------------------------------------------------
// 字段说明：
//   name      事件编号（会写进样本属性，并作为导出文件名）
//   year      年份
//   start/end 暴雨时段起止（北京时间，格式 'YYYY-MM-DD HH:mm'）
//   area      文档中“主要影响区域”
//   rain      文档中“降雨量关键数据”原文
//   rainRefMM 文档中的代表性降雨量（mm，极值/累计值，仅作参考）
//   roi       可选，默认用武汉市全域；如需用某个区做研究区，在这里换 FeatureCollection
//   preStart/preEnd        可选，显式指定事件前基线窗口（北京时间）
//   postStart/postEnd      可选，显式指定 Sentinel-1 后窗口（北京时间）
//   s2PostStart/s2PostEnd  可选，显式指定 Sentinel-2 后窗口（北京时间）
//             不写则按下面规则自动推导：
//               preEnd   = 事件开始 - PRE_GAP_DAYS
//               preStart = preEnd - PRE_WINDOW_DAYS
//               S1 后窗  = 事件结束 ~ 事件结束 + S1_POST_PAD_DAYS(18)   ← 只做搜索，合成见 post8
//               S2 后窗  = 事件结束 ~ 事件结束 + S2_POST_PAD_DAYS(18)   ←【改动24/25】18 天，指数取逐景 max
//               s2PostEnd 可用于**单场**收窄 S2 后窗：当下一场暴雨落在本场后窗内时（见
//               Wuhan_2020_0628 / Wuhan_2024_0621 两条），必须截到下一场开始之前，
//               否则 max 会把下一场的水算到本场头上。
// ============================================================================
var EVENTS = [
  {
    name: 'Wuhan_2016_0601',
    year: 2016,
    start: '2016-06-01 03:00',
    end: '2016-06-01 10:00',
    area: '洪山、光谷、汉阳、沌口',
    rain: '洪山、光谷97–115 mm；汉阳、沌口56 mm；华中农业大学附近1小时40 mm',
    rainRefMM: 115
  },
  {
    name: 'Wuhan_2016_0630',
    year: 2016,
    start: '2016-06-30 20:00',
    end: '2016-07-06 10:00',
    area: '全市，重灾区：新洲、江夏、蔡甸、南湖周边',
    rain: '全市周累计560.5 mm（历史极值）；蔡甸玉贤346.5 mm；城区挽月中学341.3 mm；主城区14小时229.1 mm',
    rainRefMM: 560.5,
    // 这一场沿用你之前已经跑通的窗口（北京时间写法）
    //   【改动24】postEnd 从这里起只对 Sentinel-1 生效；Sentinel-2 走默认规则
    //   （事件结束 + S2_POST_PAD_DAYS = 2016-07-24），不再被这个 7-25 的长窗口拖到退水后。
    preStart: '2016-05-20 00:00',
    preEnd: '2016-06-10 00:00',
    postStart: '2016-07-06 10:00',
    postEnd: '2016-07-25 00:00'
  },
  {
    name: 'Wuhan_2017_0405',
    year: 2017,
    start: '2017-04-05 17:00',
    end: '2017-04-06 07:00',
    area: '东西湖、汉口、黄陂南部、新洲',
    rain: '黄陂五湖站最大70.2 mm；城区47 mm',
    rainRefMM: 70.2
  },
  {
    name: 'Wuhan_2017_0608',
    year: 2017,
    start: '2017-06-08 20:00',
    end: '2017-06-09 20:00',
    area: '中心城区为主',
    rain: '局部暴雨，中心城区无明显渍水（文档只给“6月8日晚–9日”，此处按24小时窗口处理）',
    rainRefMM: null
  },
  {
    name: 'Wuhan_2017_0824',
    year: 2017,
    start: '2017-08-24 00:00',
    end: '2017-08-25 00:00',
    area: '市区多区',
    rain: '发布暴雨橙色预警，多区降雨量50 mm以上',
    rainRefMM: 50,
    // 【改动30】强制走 L1C：Summary8 里该场被窗口内个别 L2A 景"拖"过去后，S2 有效覆盖从
    //   98.0% 掉到 1.3%、High Flood 归零、面积虚涨 +230%（基线走 L1C 时覆盖 98.0%、
    //   High 占比 93.7%）。这里压回 L1C 以恢复基线行为。
    //   注意：仍需在 Console 核对本行的 s2_sr_count / s2_l1c_count 打印，
    //   若确认该窗口确实已有可用的 L2A 覆盖，可把本行删掉改回自动选择。
    s2Source: 'L1C'
  },
  {
    name: 'Wuhan_2018_0518',
    year: 2018,
    start: '2018-05-18 00:00',
    end: '2018-05-19 00:00',
    area: '洪山、硚口、江夏等',
    rain: '洪山中心气象台最大52.2 mm；江夏永丰水库累计105 mm',
    rainRefMM: 105
  },
  {
    name: 'Wuhan_2018_0630',
    year: 2018,
    start: '2018-06-30 20:00',
    end: '2018-07-01 20:00',
    area: '全市',
    rain: '累计315.8 mm（1998年以来最强）',
    rainRefMM: 315.8
  },
  {
    name: 'Wuhan_2019_0620',
    year: 2019,
    start: '2019-06-20 19:00',
    end: '2019-06-21 07:00',
    area: '全市，蔡甸雨量最大',
    rain: '24小时平均150 mm；蔡甸最大208 mm；最强小时雨量超2016年',
    rainRefMM: 208
  },
  {
    name: 'Wuhan_2020_0628',
    year: 2020,
    start: '2020-06-28 08:00',
    end: '2020-06-29 13:00',
    area: '全市，洪山区第二师范站最大',
    rain: '24小时最大165.9 mm；洪山第二师范站231.6 mm（28日8时–29日13时）',
    rainRefMM: 231.6,
    // 【改动25】下一场暴雨 Wuhan_2020_0705 于 07-05 06:00 开始，而默认 S2 后窗会延到 07-17；
    //   逐景 max 会把 0705 那场的水算进本场（同一批像元会被两个事件重复打上洪涝标签），
    //   故把 S2 后窗截到下一场开始之前（约 5.5 天）。
    //   副作用：观测变少、S2 有效覆盖可能明显下降（无 S2 的 SAR 候选会落入 Medium Flood）；
    //   跑完全量后请核对本行的 s2_count / s2_valid_px，若覆盖过低就要考虑单独处理本场。
    s2PostEnd: '2020-07-05 00:00'
  },
  {
    name: 'Wuhan_2020_0705',
    year: 2020,
    start: '2020-07-05 06:00',
    end: '2020-07-06 06:00',
    area: '江夏区（乌龙泉）最重，武昌、汉阳',
    rain: '江夏乌龙泉432.5 mm（单日历史极值）；最大小时88.3 mm',
    rainRefMM: 432.5,
    // 6月28–29日刚下过一场暴雨，基线窗口往前挪，避免把上一场洪水当背景
    preStart: '2020-05-25 00:00',
    preEnd: '2020-06-15 00:00'
  },
  {
    name: 'Wuhan_2021_0510',
    year: 2021,
    start: '2021-05-10 14:00',
    end: '2021-05-10 22:00',
    area: '东湖风景区、洪山区',
    rain: '东湖城市学院站122.1 mm；洪山中心气象台小时94.7 mm',
    rainRefMM: 122.1
  },
  {
    name: 'Wuhan_2021_0823',
    year: 2021,
    start: '2021-08-23 08:00',
    end: '2021-08-24 08:00',
    area: '蔡甸、东西湖、黄陂南部、新洲、中心城区',
    rain: '东西湖常青路站最大143.6 mm',
    rainRefMM: 143.6
  },
  {
    name: 'Wuhan_2022_0627',
    year: 2022,
    start: '2022-06-27 19:00',
    end: '2022-06-28 06:00',
    area: '蔡甸、新洲',
    rain: '蔡甸侏儒站156.4 mm；武荆高速站小时61.6 mm',
    rainRefMM: 156.4
  },
  {
    name: 'Wuhan_2023_0618',
    year: 2023,
    start: '2023-06-18 18:00',
    end: '2023-06-19 06:00',
    area: '江夏区',
    rain: '江夏舒安站224 mm；最大小时64 mm',
    rainRefMM: 224
  },
  {
    name: 'Wuhan_2023_0719',
    year: 2023,
    start: '2023-07-19 12:00',
    end: '2023-07-20 07:00',
    area: '武汉经开区（江汉大学站）',
    rain: '累计162.3 mm；最大小时雨强创1951年以来历史极值',
    rainRefMM: 162.3
  },
  {
    // 【改动28】原 Wuhan_2024_0621 与 Wuhan_2024_0628 相隔 7 天，已合并为一场"6 月双峰暴雨"。
    //   合并理由（见文档【改动28】）：
    //     ① 保持两场独立 + 给 0621 手工截断到 06-28（原【改动25(c)】）→ 06-22~06-27 只有 5 景且几乎
    //        全被云盖，High Flood = 0、标签退化成纯 SAR 推断（Summary8：S2 覆盖 0.3%）；
    //     ② 取消截断 → 两场会共用 06-28 之后的 11.8 天影像（占各自窗口 65.5%），同一批像元被两个
    //        事件重复打标签，既有标签混淆也有训练集泄漏风险；
    //     ③ 合并后只剩一条标签，既无重复也不丢观测。
    name: 'Wuhan_2024_0621_0628',
    year: 2024,
    // start = 首场起点；end = **首场终点**（不是次场终点）——
    //   因为 end 决定 SAR 后时相合成的起点（最早 S1 = t0 → 合成跨度 [t0, t0+8 天]）。
    //   取首场终点可以让后时相合成尽早开始，8 天跨度才有可能同时覆盖 06-28 的次场；
    //   若取次场终点（06-28 12:00），后时相全部晚于次场，首场的积水面会被整体丢掉。
    start: '2024-06-21 07:00',
    end: '2024-06-22 07:00',
    area: '首场：黄陂、东西湖、蔡甸、江夏、经开区；次场：东西湖（长青街站）',
    rain: '首场（6/21–22）多个区 24 小时累计超 100 mm；次场（6/28）东西湖长青街站 147.8 mm；两场合计约 247.8 mm',
    rainRefMM: 247.8,
    // 【改动28】S2 后窗取两场默认窗口之并（06-21 ~ 07-16，24 天，比常规 18 天长）：
    //   常规 18 天会在 07-10 就截止，丢掉次场后段的晴空观测。这是本场唯一的窗口特例，须在方法里写明。
    // 已核对的副作用：合并后 SAR 后时相从首场结束（06-22）起算，8 天跨度若只覆盖到次场的一部分，
    //   "只在首场积水、之后已退"的像元会漏检——属欠检（不会把没水的地方标成水），
    //   表现为面积偏小而非虚涨。重跑后请核对本行的 s1_post_after_dates / s2_count / s2_qc_flag。
    s2PostEnd: '2024-07-16 00:00'
  },
  {
    name: 'Wuhan_2025_0522',
    year: 2025,
    start: '2025-05-22 00:00',
    end: '2025-05-22 16:00',
    area: '洪山区（理工大学站）',
    rain: '洪山理工大学站189 mm',
    rainRefMM: 189,
    // 【改动31】S2 后窗原为默认 18 天（止于 2025-06-09），会伸进 06-07 00:00（北京时）起爆的
    //   第二场暴雨 2.7 天 —— 逐景 max 会把后一场的水并进本场标签。
    //   按【改动31】诊断实测（`doc/labelConsole2.md`）：整窗有效像元 755,178，其中"只在尾段有效
    //   （截掉就丢）"仅 4,444 px = **0.6% ≤ 5% 阈值** → 尾段（06-07 那 4 景，共 11,732 px 有效）
    //   没有提供新的晴空观测，可以安全截掉，不会重演 2024_0621 的"截完就 NO_OPTICAL"。
    //   代价与连带检查：06-07 的 4 景退出本场标签；它们也不属于 `Wuhan_2025_0607` 的后窗
    //   （那场从事件结束 06-09 起算 → 06-08 16:00 UTC 起），所以不会让另一场丢观测。
    //   截断后【改动29】自检不再命中本场，【改动31】诊断也不再触发（无重叠可诊断）。
    s2PostEnd: '2025-06-07 00:00'
  },
  {
    name: 'Wuhan_2025_0607',
    year: 2025,
    start: '2025-06-07 00:00',
    end: '2025-06-09 00:00',
    area: '北部（新洲等）',
    rain: '新洲张渡湖站117.2 mm（6月21日数据，同期另有高考期间强降雨）',
    rainRefMM: 117.2,
    // 5月22日刚下过一场暴雨，基线窗口往前挪
    preStart: '2025-04-25 00:00',
    preEnd: '2025-05-15 00:00'
  },
  // --------------------------------------------------------------------------
  // 【改动33】"零暴雨"对照事件（isControl）——只回答一个问题：
  //   `2022_0627`、`2023_0618` 标签里的水，是洪水还是季节性明水（泡田/灌溉/常年水面）+ 残云？
  //   做法：把**完全同一套流程**跑在"事件表里没有任何暴雨"的同期窗口上：
  //     若对照窗口也能产出量级相当的 High Flood → 那些水不是洪水撑起来的；
  //     若对照窗口几乎为 0 → 说明标签确实由暴雨驱动（这才是想看到的）。
  //   注意：
  //     ① 默认全量**不跑**（EVENTS_TO_RUN 会过滤 isControl），只在 RUN_EVENT_NAMES 里点名才跑：
  //          RUN_EVENT_NAMES = ['Wuhan_2022_0601_CTRL', 'Wuhan_2023_0525_CTRL']
  //     ② 越界自检（【改动29】）与尾段诊断（【改动31】）都会跳过对照事件；
  //     ③ 跑之前请用雨量记录确认这两个窗口确实没有暴雨（本事件表里它们附近没有暴雨时段）；
  //     ④ 对照事件不进任何训练/验证划分，只作为"标签是不是季节性明水"的证据。
  {
    name: 'Wuhan_2022_0601_CTRL',
    year: 2022,
    isControl: true,
    start: '2022-06-01 00:00',
    end: '2022-06-01 02:00',
    area: '对照：全市（无暴雨窗口）',
    rain: '（对照事件：非暴雨期，仅用于估计季节性明水与残云）',
    rainRefMM: null
  },
  {
    // 窗口止于 2023-06-12，避开 06-18 的暴雨（那场 06-18 18:00 起）
    name: 'Wuhan_2023_0525_CTRL',
    year: 2023,
    isControl: true,
    start: '2023-05-25 00:00',
    end: '2023-05-25 02:00',
    area: '对照：全市（无暴雨窗口）',
    rain: '（对照事件：非暴雨期；S2 后窗止于 06-12，避开 06-18 暴雨）',
    rainRefMM: null
  }
];

// 只跑部分时段：null = 跑 EVENTS 全部；
// 想单独取某一段数据时，例如：var RUN_EVENT_NAMES = ['Wuhan_2020_0705'];
//
// 【改动24】先做 5 事件对照，别一上来就全量重跑（rivision.md 第 11 节）：
//   前 4 个是"面积/雨量比明显偏低"（且 n_medium_flood_px = 0）的事件，
//   2020_0705 作为大面积对照；重点看缩短 S2 后 High Flood 是否回升、S1 覆盖率是否稳定。
//   对照通过后，把下面这行改回 null 再全量重跑 19 个事件。
// 【改动31】默认值改回全量：Summary9 已经是 18 事件全量结果，默认值必须与它一致，
//   否则点一下 Run 只会出 5 行、看起来像"数据丢了"。要单独复核某一两场时，
//   临时把下面这行换成数组即可（改完记得改回来）：
//     var RUN_EVENT_NAMES = ['Wuhan_2025_0522'];
// 【伪标签精度验证·第1轮】只跑三场代表性事件：2020大面积 / 2021多云 / 2023可疑低面积
var RUN_EVENT_NAMES = [
  'Wuhan_2020_0705',
  'Wuhan_2021_0823',
  'Wuhan_2023_0618'
];
// var RUN_EVENT_NAMES = [           // ← 【改动24】的 5 事件对照名单（已跑完，留档备查）
//   'Wuhan_2021_0823',   // 低面积：143.6 mm / 面积偏小
//   'Wuhan_2022_0627',   // 低面积
//   'Wuhan_2023_0618',   // 低面积（雨量 224 mm 但面积很小，最可疑）
//   'Wuhan_2023_0719',   // 低面积
//   'Wuhan_2020_0705'    // 对照：大面积、雨量最大
// ];

// Map 上显示哪个时段的结果（必须是 EVENTS 里的 name）
//   注意这里是字符串，不是数组（数组会让 name === 判断永远为 false，只能靠 fallback）
var VIEW_EVENT_NAME = 'Wuhan_2020_0705';


// ============================================================================
// 3.【改动2】时间窗口工具函数（北京时间 → UTC 换算 + 事件前/后窗口推导）
//   原 temp.js 没有这一节：窗口是手工写死的，且直接当 UTC 用；
//   文档里的时间是北京时间(UTC+8)，这里统一换算，避免短时段对不上影像。
// ============================================================================

// 北京时间字符串 -> JS Date（UTC）
function bjToUTC(dateTimeStr) {
  var m = String(dateTimeStr).trim().replace(' ', 'T')
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2})(?::(\d{2}))?)?/);
  if (!m) {
    throw new Error('无法解析时间字符串（需要 YYYY-MM-DD HH:mm）: ' + dateTimeStr);
  }
  var hh = (m[4] ? Number(m[4]) : 0) - TZ_OFFSET_HOURS;
  var mm = m[5] ? Number(m[5]) : 0;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0));
}

function addDays(jsDate, n) {
  return new Date(jsDate.getTime() + n * 24 * 3600 * 1000);
}

function isoDate(jsDate) {
  return jsDate.toISOString().slice(0, 10);
}

// 诊断用：影像时间戳 → 北京时（带时刻）
//   原来只打印到天，同一天的影像分不出是事件前还是事件后。
function fmtBjDateTime(ms) {
  return ee.Date(ms).advance(TZ_OFFSET_HOURS, 'hour')
    .format('YYYY-MM-dd HH:mm');
}

// 【改动18】去掉 Sentinel-1 GRD 切片的无数据填充值
//   切片的填充值是很负的 dB（不是 0），mask() 报告为有效，必须显式掩掉，
//   否则切片边界会出现 -30000 dB 级别的假变化，既污染判识也污染抽样。
function dropFill(im) {
  return im.updateMask(im.gt(S1_FILL_DB));
}

// 计算某个事件的“事件前基线窗口”和“事件后窗口”
//  【改动24】后窗口拆成 S1 / S2 两个，各自有独立的结束时间：
//    S1：事件结束 ~ 事件结束 + S1_POST_PAD_DAYS(18)  —— 只是搜索窗口，实际合成 = 最早 S1 之后 8 天（见 post8）
//    S2：事件结束 ~ 事件结束 + S2_POST_PAD_DAYS(18)  —— 覆盖优先，"退水稀释"由逐景 max 口径解决
//  拆开的原因：S1 受重访周期限制，缩短窗口会让部分事件后时相影像不足；S2 受退水速度限制，
//  窗口太长会把"已经退水"的影像平均进来。两者诉求相反，不能再共用一个参数。
function eventWindows(ev) {
  var startUTC = bjToUTC(ev.start);
  var endUTC = bjToUTC(ev.end);

  // Sentinel-1 后窗口（旧的 ev.postStart / ev.postEnd 仍然有效，语义收敛为"只作用于 S1"）
  var s1PostStartJs = ev.postStart ? bjToUTC(ev.postStart)
    : endUTC;
  var s1PostEndJs   = ev.postEnd ? bjToUTC(ev.postEnd)
    : addDays(endUTC, S1_POST_PAD_DAYS);

  // Sentinel-2 后窗口（起点也定在事件结束；可选用 ev.s2PostStart / ev.s2PostEnd 手工覆盖）
  var s2PostStartJs = ev.s2PostStart ? bjToUTC(ev.s2PostStart)
    : endUTC;
  var s2PostEndJs   = ev.s2PostEnd ? bjToUTC(ev.s2PostEnd)
    : addDays(endUTC, S2_POST_PAD_DAYS);
  var preEndJs = ev.preEnd ? bjToUTC(ev.preEnd)
    : addDays(startUTC, -PRE_GAP_DAYS);
  var preStartJs = ev.preStart ? bjToUTC(ev.preStart)
    : addDays(preEndJs, -PRE_WINDOW_DAYS);

  return {
    preStart: ee.Date(preStartJs),
    preEnd: ee.Date(preEndJs),

    // Sentinel-1 后时相窗口
    s1PostStart: ee.Date(s1PostStartJs),
    s1PostEnd: ee.Date(s1PostEndJs),

    // Sentinel-2 后时相窗口
    s2PostStart: ee.Date(s2PostStartJs),
    s2PostEnd: ee.Date(s2PostEndJs),

    preStartStr: isoDate(preStartJs),
    preEndStr: isoDate(preEndJs),

    s1PostStartStr: isoDate(s1PostStartJs),
    s1PostEndStr: isoDate(s1PostEndJs),

    s2PostStartStr: isoDate(s2PostStartJs),
    s2PostEndStr: isoDate(s2PostEndJs),

    preDays: Math.round((preEndJs - preStartJs) / 86400000),

    s1PostDays: Math.round((s1PostEndJs - s1PostStartJs) / 86400000),
    s2PostDays: Math.round((s2PostEndJs - s2PostStartJs) / 86400000)
  };
}


// 4.【改动3】单个时段：SAR + 光学 伪标签与训练样本
var FEATURE_NAMES = [
  'VV', 'VH', 'VV_diff', 'VH_diff', 'VV_ratio',
  'NDVI', 'MNDWI', 'DEM', 'slope', 'S2_Valid'
];

// 汇总表的基础字段（每个时段一行）
function summaryBase(ev, w, avail, s2Source) {
  return {
    event_id: ev.name,
    year: ev.year,
    storm_start_bj: ev.start,
    storm_end_bj: ev.end,
    pre_window_utc: w.preStartStr + ' ~ ' + w.preEndStr,
    // post_window_utc / post_days 沿用旧列名，含义收敛为「Sentinel-1 后窗口」
    post_window_utc: w.s1PostStartStr + ' ~ ' + w.s1PostEndStr,
    pre_days: w.preDays,
    post_days: w.s1PostDays,
    // 【改动24/25】Sentinel-2 后窗 = S2_POST_PAD_DAYS(18) 天（个别事件用 s2PostEnd 收窄），单独记两列
    s2_post_window_utc: w.s2PostStartStr + ' ~ ' + w.s2PostEndStr,
    s2_post_days: w.s2PostDays,
    // 【改动25】光学合成口径，便于跨版本追溯
    s2_index_stat: S2_INDEX_STAT,
    area: ev.area,
    rain_ref_mm: ev.rainRefMM,
    rainfall: ev.rain,
    s1_pre_count: avail.s1_pre_count,
    s1_post_count: avail.s1_post_count,
    s2_source: s2Source,
    s2_count: avail.s2_sr_count + avail.s2_l1c_count,
    n_flood_px: null,
    n_nonflood_px: null,
    n_high_flood_px: null,
    n_medium_flood_px: null,
    n_high_nonflood_px: null,
    n_medium_nonflood_px: null,
    s2_valid_px: null,
    // 【改动27】S2 光学覆盖质控（跳过的时段也保留列）
    n_valid_px: null,
    s2_cover_valid_frac: null,
    high_flood_share: null,
    s2_qc_flag: null,
    sample_count: null,
    status: 'SKIPPED_NO_S1'
  };
}

function buildEvent(ev) {
  var roi = ev.roi || DEFAULT_ROI;
  var geom = roi.geometry();
  var w = eventWindows(ev);

  // ----------------------------------------------------------
  // 4.1 Sentinel-1（事件前 / 事件后）
  // ----------------------------------------------------------
  function getS1Collection(start, end) {
    return ee.ImageCollection('COPERNICUS/S1_GRD')
      .filterBounds(roi)
      .filterDate(start, end)
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
      .select(['VV', 'VH']);
  }

  var s1preCol = getS1Collection(w.preStart, w.preEnd);
  // 【改动24】S1 仍用 18 天搜索窗口（不受 S2 缩短影响）
  var s1postCol = getS1Collection(w.s1PostStart, w.s1PostEnd);

  // ----------------------------------------------------------
  // 4.2【改动6】Sentinel-2（L2A 优先，窗口内为 0 景时回退 L1C；另加云量过滤）
  //   原 temp.js 只用 COPERNICUS/S2_SR_HARMONIZED，且不按云量筛选，
  //   2016 年没有 L2A 产品 → 原脚本 2016 时段拿不到任何 S2。
  // ----------------------------------------------------------
  // 【改动32】两档云掩膜：QA60（原口径）/ QA60 ∧ SCL（更严，仅 L2A 有 SCL）
  function maskS2(image, useScl) {
    var qa = image.select('QA60');
    var clear = qa.bitwiseAnd(1 << 10).eq(0)
      .and(qa.bitwiseAnd(1 << 11).eq(0));
    if (useScl) {
      var scl = image.select('SCL');
      var bad = scl.eq(1).or(scl.eq(3)).or(scl.eq(8))
        .or(scl.eq(9)).or(scl.eq(10)).or(scl.eq(11));
      clear = clear.and(bad.not());
    }
    return image.updateMask(clear);
  }

  // 【改动31】逐景的 S2 有效性指示带（云掩膜后该景是否仍有观测，0/1）。
  //   主流程（s2IdxCol）与"越界尾段诊断"共用同一写法，避免两处口径漂移。
  function s2ValidBand(im) {
    return im.select('B3').mask().unmask(0).gt(0).rename('S2_Valid');
  }

  function getS2Collection(id, useScl) {
    return ee.ImageCollection(id)
      .filterBounds(roi)
      // 【改动24/25】只取事件结束后 S2_POST_PAD_DAYS(18) 天：
      //   洪水消退远快于 SAR/S2 重访，18 天窗口后半段的影像多半已经退水，
      //   会把实际有水的像元算成 MNDWI 偏低（High Flood 漏检、面积低估）。
      .filterDate(w.s2PostStart, w.s2PostEnd)
      .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', S2_MAX_CLOUD))
      .map(function (im) { return maskS2(im, useScl); });
  }

  // 【改动32】L2A 才有 SCL；L1C 一律退回 QA60
  var useSclSr = (S2_CLOUD_MASK === 'SCL_AND_QA60');
  var s2srCol = getS2Collection('COPERNICUS/S2_SR_HARMONIZED', useSclSr);
  var s2l1cCol = getS2Collection('COPERNICUS/S2_HARMONIZED', false);

  // ----------------------------------------------------------
  // 4.3数据可用性检查（每个时段单独检查一次，缺 S1 的时段跳过）
  var avail = ee.Dictionary({
    s1_pre_count: s1preCol.size(),
    s1_post_count: s1postCol.size(),
    // 日期统一带北京时时刻，便于判断某景在事件前还是事件后
    s1_pre_dates: s1preCol.aggregate_array('system:time_start')
      .map(fmtBjDateTime),
    s1_post_dates: s1postCol.aggregate_array('system:time_start')
      .map(fmtBjDateTime),
    // 后窗口里真正晚于事件结束的影像：=0 说明后时相不代表洪水状态
    s1_post_after_count: s1postCol
      .filterDate(ee.Date(bjToUTC(ev.end)), w.s1PostEnd).size(),
    s1_post_after_dates: s1postCol
      .filterDate(ee.Date(bjToUTC(ev.end)), w.s1PostEnd)
      .aggregate_array('system:time_start').map(fmtBjDateTime),
    s2_sr_count: s2srCol.size(),
    s2_l1c_count: s2l1cCol.size(),
    // S2 也打印日期：光学证据取自后窗口的哪几天
    s2_sr_dates: s2srCol.aggregate_array('system:time_start')
      .map(fmtBjDateTime),
    s2_l1c_dates: s2l1cCol.aggregate_array('system:time_start')
      .map(fmtBjDateTime)
  }).getInfo();

  // 【改动30】允许事件表强制指定 S2 源：ev.s2Source = 'L1C' / 'L2A'（不写则沿用"L2A 优先"自动选择）
  //   背景：2017_0824 在 Summary8 里从 L1C 翻成了 L2A——窗口内只要出现**个别** L2A 景，
  //         整场就被换到另一套辐射口径，而那个 L2A 在窗口内几乎全无效：
  //         S2 覆盖 98.0% → 1.3%、High Flood 归零、面积虚涨 +230%。
  //         这类"个别景把整场拖走"的问题必须能手工压回，所以加这个开关。
  var s2Source = 'NONE';
  var s2Col = s2srCol;
  var forcedS2 = ev.s2Source ? String(ev.s2Source).toUpperCase() : null;
  if (forcedS2 === 'L1C') {
    s2Source = 'S2_HARMONIZED(L1C/TOA)';
    s2Col = s2l1cCol;
    print('【改动30】S2 数据源被事件表强制指定为 L1C（本窗口 L2A 景数 = '
      + avail.s2_sr_count + '）');
  } else if (forcedS2 === 'L2A') {
    s2Source = 'S2_SR_HARMONIZED(L2A)';
    s2Col = s2srCol;
    print('【改动30】S2 数据源被事件表强制指定为 L2A（本窗口 L1C 景数 = '
      + avail.s2_l1c_count + '）');
  } else if (avail.s2_sr_count > 0) {
    s2Source = 'S2_SR_HARMONIZED(L2A)';
    s2Col = s2srCol;
  } else if (avail.s2_l1c_count > 0) {
    s2Source = 'S2_HARMONIZED(L1C/TOA)';
    s2Col = s2l1cCol;
  }
  // 强制指定的源若在本窗口内一景都没有，明确报出来（否则后面只会得到空集合、静默失败）
  if (forcedS2 && s2Col.size().getInfo() === 0) {
    print('⚠ ' + ev.name + '：事件表强制指定的 S2 源（' + forcedS2
      + '）在本窗口内 0 景，请改回自动选择或调整窗口。');
  }

  print('────────── ' + ev.name + '（' + ev.year + '）──────────');
  print('暴雨时段(北京时): ' + ev.start + ' ~ ' + ev.end + ' | ' + ev.area);
  print('影像窗口(UTC): 事件前 ' + w.preStartStr + ' ~ ' + w.preEndStr
    + '（' + w.preDays + '天）');
  print('  S1 后窗 ' + w.s1PostStartStr + ' ~ ' + w.s1PostEndStr
    + '（' + w.s1PostDays + '天，搜索窗口；实际合成 = 最早 S1 之后 8 天）');
  print('  S2 后窗 ' + w.s2PostStartStr + ' ~ ' + w.s2PostEndStr
    + '（' + w.s2PostDays + '天；常规 ' + S2_POST_PAD_DAYS
    + ' 天，被截断/合并的事件按事件表取值【改动25/28】；光学口径 = 逐景指数取 '
    + S2_INDEX_STAT + '）');
  print('数据可用性:', avail);
  print('S2 数据源: ' + s2Source);
  // 【改动32】说明本场实际用的云掩膜（L1C 无 SCL → 即使开关打开也只能用 QA60）
  print('S2 云掩膜: ' + S2_CLOUD_MASK
    + ((S2_CLOUD_MASK === 'SCL_AND_QA60')
      ? ((s2Source.indexOf('L1C') !== -1)
        ? '（本场走 L1C，无 SCL → 实际只用 QA60）'
        : '（QA60 ∧ SCL，更严）')
      : '（QA60，原口径）'));

  // 【改动24】S2 窗口缩短后的连带风险：窗口内一景都没有 → 没有光学水体证据，
  //   High Flood 必为 0、SAR 候选全部落进 Medium Flood、High Non-Flood 也取不到样本。
  //   出现这条警告时，给该事件手工指定 s2PostStart / s2PostEnd 调窗口，或核对事件表里的时间。
  if (avail.s2_sr_count === 0 && avail.s2_l1c_count === 0) {
    print('⚠ ' + ev.name + '：S2 后窗口 ' + w.s2PostStartStr + ' ~ '
      + w.s2PostEndStr + ' 内没有可用影像 → 该时段没有光学水体证据，'
      + 'High Flood 会是 0，SAR 候选全部落入 Medium Flood。');
    print('   建议：为该事件手工指定 s2PostStart / s2PostEnd，或核对事件表里的起止时间。');
  }

  // 后时相审计：后窗口有影像、但没有一景晚于事件结束
  if (avail.s1_post_after_count === 0 && avail.s1_post_count > 0) {
    print('⚠ ' + ev.name + '：后窗口内有 ' + avail.s1_post_count
      + ' 景 S1，但全部早于/等于事件结束 → 后时相不代表洪水状态，'
      + '该时段伪标签不可靠。');
    print('   建议：为该事件手工指定 postEnd（事件结束后 12~18 天），'
      + '或增大 S1_POST_PAD_DAYS。');
  }

  if (avail.s1_pre_count === 0 || avail.s1_post_count === 0) {
    print('⚠ ' + ev.name + '：事件前或事件后窗口内没有 S1 影像，跳过该时段'
      + '（可增大 S1_POST_PAD_DAYS 或调整窗口后重跑）。');
    return {
      name: ev.name,
      skipped: true,
      summary: summaryBase(ev, w, avail, s2Source),
      samples: ee.FeatureCollection([])
    };
  }

  // ----------------------------------------------------------
  // 4.4 SAR 时相合成与变化特征
  // ----------------------------------------------------------
  // 【改动18】前时相同样过滤填充值：前窗两条轨道各 4 景，某些像元可能只有一条轨道有数据，
  //   不过滤的话 median 会被填充值污染，vv_diff 反而不准。
  var s1_pre = s1preCol.map(dropFill).median().clip(roi);

  var vv_pre = s1_pre.select('VV').rename('VV_pre');
  var vh_pre = s1_pre.select('VH').rename('VH_pre');

  // 事件后最早 8 天：跨 orbit 40 与 113 两条轨道，掩膜取并集才能盖满研究区
  var t0 = ee.Date(s1postCol.aggregate_min('system:time_start'));
  var post8 = s1postCol
    .filterDate(t0, t0.advance(8, 'day'))
    .map(dropFill);

  // 【改动21】逐景去偏（DEBIAS_MODE = 'perImage'）
  //   每景各自减掉"它相对前窗基线的中位偏移"。实测本事件里 orbit 40 的偏移 +1.31~+1.75 dB、
  //   orbit 113 是 +0.25~+0.63 dB，差接近 0.9 dB；只扣一个全局中位数的话，orbit 40 区域会
  //   偏亮（洪涝低估）、orbit 113 区域会偏暗（洪涝高估），形成沿轨道的条纹。逐景扣完再合成
  //   才在空间上一致。
  function debiasOne(im) {
    var dv = im.select('VV').subtract(vv_pre);
    var dh = im.select('VH').subtract(vh_pre);
    var ov = ee.Number(dv.reduceRegion({
      reducer: ee.Reducer.median(), geometry: geom,
      scale: SAMPLE_SCALE, bestEffort: true, maxPixels: 1e10}).values().get(0));
    var oh = ee.Number(dh.reduceRegion({
      reducer: ee.Reducer.median(), geometry: geom,
      scale: SAMPLE_SCALE, bestEffort: true, maxPixels: 1e10}).values().get(0));
    // 把这一景自己的偏移记在属性里：其它模式也要靠它统计"偏移离散度"（QC 指标）
    // 【坑】image 的算术运算（subtract）会丢掉原有属性，连 system:time_start 也丢，
    //   所以诊断表要用的时间和轨道必须在这里显式带成自定义属性。
    return im.subtract(ee.Image.constant([ov, oh]))    // 波段顺序 [VV, VH]，逐波段扣自己的偏移
      .set('vv_off_db', ov).set('vh_off_db', oh)
      .set('t_bj', ee.Date(im.get('system:time_start'))
        .advance(TZ_OFFSET_HOURS, 'hour').format('MM-dd HH:mm'))
      .set('orbit', im.get('relativeOrbitNumber_start'));
  }

  // 原始合成：绝对后向散射特征（VV / VH / VV_ratio）继续用它，保持物理可解释
  var s1_post = post8.median().clip(roi);

  var vv_post = s1_post.select('VV').rename('VV');
  var vh_post = s1_post.select('VH').rename('VH');

  // 逐景去偏的结果：'perImage' 用它的合成做差值；三种模式都算，其它模式只用它带的偏移做 QC
  var postCorrCol = post8.map(debiasOne);
  var postCorr = postCorrCol.median();
  var vv_post_c = (DEBIAS_MODE === 'perImage') ? postCorr.select('VV') : vv_post;
  var vh_post_c = (DEBIAS_MODE === 'perImage') ? postCorr.select('VH') : vh_post;

  //前后时相同时有效的像元（避免把“无 SAR 数据”当成稳定区/非洪涝）
  var s1Valid = vv_pre.mask().and(vh_pre.mask())
    .and(vv_post.mask()).and(vh_post.mask())
    .unmask(0);

  var vv_diff = vv_post_c.subtract(vv_pre).rename('VV_diff');
  var vh_diff = vh_post_c.subtract(vh_pre).rename('VH_diff');

  // 【改动21】场景级偏移：测量并扣除
  //   'global'   ：扣的就是这个整幅偏移；
  //   'perImage' ：扣的是"逐景校正之后剩下的残差"（实测 +0.25 dB 量级）。
  //                逐景校正已经处理掉轨道间的差异（~1.06 dB），这里只是 0.25 dB 级微调，
  //                目的是让 VV_diff / VH_diff 的中位数彻底回到 0；不会重现"沿轨道条纹"。
  //   summary 里的 vv_offset_db / vh_offset_db 记录被扣掉的量，便于跨事件比较。
  var vvOff = ee.Number(0);
  var vhOff = ee.Number(0);
  if (DEBIAS_MODE !== 'none') {
    vvOff = ee.Number(vv_diff.updateMask(s1Valid).reduceRegion({
      reducer: ee.Reducer.median(), geometry: geom, scale: SAMPLE_SCALE,
      bestEffort: true, maxPixels: 1e10}).values().get(0));
    vhOff = ee.Number(vh_diff.updateMask(s1Valid).reduceRegion({
      reducer: ee.Reducer.median(), geometry: geom, scale: SAMPLE_SCALE,
      bestEffort: true, maxPixels: 1e10}).values().get(0));
    vv_diff = vv_diff.subtract(vvOff).rename('VV_diff');
    vh_diff = vh_diff.subtract(vhOff).rename('VH_diff');
  }

  // dB 先转线性功率再相除；
  var vv_ratio = vv_post.expression('pow(10, b(0) / 10)')
    .divide(vv_pre.expression('pow(10, b(0) / 10)'))
    .rename('VV_ratio');

  var sarFlood = vv_diff.lt(VV_THRESHOLD)
    .and(vh_diff.lt(VH_THRESHOLD))
    .rename('SAR_Flood');

  // 洪水候选同样用 s1Valid 约束，只有前后都有观测的像元才可能被判为洪水
  var sarFlood01 = sarFlood.unmask(0).and(s1Valid);

 
  //   var vvThreshold = -4.0;  var vhThreshold = -3.5;

 
  // 4.5【改动25/26】光学证据（逐景算指数 → 时间维取统计量）
  // ----------------------------------------------------------

  // 逐景先算指数，再在时间维取统计量（S2_INDEX_STAT = 'max' / 'median'）：
  //   每景输出 [NDVI, MNDWI, S2_Valid]；S2_Valid 是该景"云掩膜后仍有观测"的 0/1 指示带。
  //   【改动26】S2_Valid 只作为逐景指示收集，最终**恒取 max**（见下），
  //     含义 = "窗口内至少有一次有效观测"，与原 temp1.5 的 s2Valid 语义完全一致。
  var s2IdxCol = s2Col.map(function (im) {
    var valid = s2ValidBand(im);
    return im.normalizedDifference(['B8', 'B4']).rename('NDVI')
      .addBands(im.normalizedDifference(['B3', 'B11']).rename('MNDWI'))
      .addBands(valid.rename('S2_Valid'));
  });

  // 指数（NDVI / MNDWI）按 S2_INDEX_STAT 取时间维统计量；S2_Valid 不参与该统计量。
  //   （s2Idx 里仍带一条 S2_Valid 带，但它已不再被使用，有效性统一走下面的 max 口径。）
  var s2Idx = ((S2_INDEX_STAT === 'median') ? s2IdxCol.median() : s2IdxCol.max())
    .clip(roi);

  // 【改动26】有效覆盖与统计量解耦（修复）
  //   旧写法 `s2Idx.select('S2_Valid')` 会让 0/1 指示带跟着一起被 median 折叠：
  //     "窗口内至少 1 景有效" 被悄悄变成 "超过一半的景有效"。
  //   同一批影像、同一个窗口，S2 有效覆盖会凭空下降——实测 18 天档（Summary7）：
  //     2020_0705 86.5% → 34.5%、2021_0823 99.8% → 91.9%（其余 3 场几乎不变）。
  //   覆盖率一掉，SAR 洪水候选就大批落入 Medium Flood（面积虚涨）、非洪涝类同步漂移，
  //   于是 S2_INDEX_STAT='median' 的对照会同时改动"口径"和"覆盖"两个变量，无法归因。
  //   恒取 max 之后：无论统计量切到哪一档，s2_valid_px 与 Medium 两类都与 'max' 档完全一致。
  var s2Valid = s2IdxCol.select('S2_Valid').max().unmask(0).gt(0).rename('S2_Valid');
  var ndvi = s2Idx.select('NDVI').rename('NDVI');
  var mndwi = s2Idx.select('MNDWI').rename('MNDWI');

  // ----------------------------------------------------------
  // 4.5b【改动31】S2 后窗"越界尾段"的晴空贡献诊断（只对与后一场暴雨重叠的事件跑）
  //   问题：2025_0522 的 S2 后窗（止于 2025-06-09）伸进 2025_0607 的暴雨（起于 2025-06-07）
  //     2.7 天。逐景 max 会把后一场的水并进前一场标签，所以"最好截掉"；
  //     但若尾段恰好是窗口里唯一的晴空观测，截完就会重演 2024_0621 的 NO_OPTICAL
  //     （S2 覆盖 0.3%、High Flood = 0）。
  //   判据：不是 s2_count（那只是集合大小，L2A/L1C 各算一遍），而是
  //     "整窗有效像元里有多少只在尾段有效" = n_tail_excl（截掉就丢的量）。
  //   判读（与 s2_valid_px 同口径：sum 面积加权、scale = SAMPLE_SCALE）：
  //     n_tail_excl / n_window 很小 → 尾段没带来新的晴空观测，可以安全截到后一场起点之前；
  //     明显偏大                  → 不要截，按【改动28】把两场合并为一场。
  //   参考阈值 5%：低于它，截断造成的光学证据损失可忽略。
  // ----------------------------------------------------------
  if (S2_TAIL_DIAG) {
    var tailHits = s2WindowOverlapHits(ev);
    if (tailHits.length > 0) {
      var tailHit = tailHits[0];                       // EVENTS 按时间排序 → 最近的一场
      var tailCutJs = new Date(tailHit.startMs);       // 后一场暴雨起点（UTC）
      var tailHeadCol = s2Col.filterDate(w.s2PostStart, ee.Date(tailCutJs));
      var tailCol = s2Col.filterDate(ee.Date(tailCutJs), w.s2PostEnd);
      var tailHeadValid = tailHeadCol.map(s2ValidBand).select('S2_Valid')
        .max().unmask(0).gt(0);
      var tailValid = tailCol.map(s2ValidBand).select('S2_Valid')
        .max().unmask(0).gt(0);
      var tailDiag = ee.Image.cat([
        s2Valid.toInt().rename('n_window'),                                 // 整窗并集
        tailHeadValid.toInt().rename('n_head'),                             // 截断后剩下的并集
        tailValid.toInt().rename('n_tail'),                                 // 尾段并集
        tailValid.and(tailHeadValid.not()).toInt().rename('n_tail_excl'),   // 只在尾段有效（截掉就丢）
        tailHeadValid.and(tailValid.not()).toInt().rename('n_head_excl')    // 只在截断段有效
      ]).reduceRegion({
        reducer: ee.Reducer.sum(), tileScale: 8, geometry: geom,
        scale: SAMPLE_SCALE, bestEffort: true, maxPixels: 1e10
      }).getInfo() || {};
      var nWindowValid = tailDiag.n_window || 0;
      var nHeadValid = tailDiag.n_head || 0;
      var nTailExcl = tailDiag.n_tail_excl || 0;
      var tailExclShare = (nWindowValid > 0) ? (nTailExcl / nWindowValid) : 0;
      print('【改动31】' + ev.name + ' 的 S2 后窗越界尾段诊断（与 ' + tailHit.name
        + ' 重叠 ' + tailHit.overlapDays.toFixed(1) + ' 天；尾段起点 = '
        + tailHit.startStr + ' 北京时 / ' + isoDate(tailCutJs) + ' UTC）：');
      print('   整窗 ' + w.s2PostStartStr + ' ~ ' + w.s2PostEndStr
        + ' 有效像元 = ' + nWindowValid
        + ' | 截到后一场起点之前 = ' + nHeadValid
        + ' | 只在尾段有效（截掉就丢）= ' + nTailExcl
        + '（占整窗 ' + (tailExclShare * 100).toFixed(1) + '%）'
        + ' | 尾段总有效 = ' + (tailDiag.n_tail || 0));
      if (tailExclShare > 0.05) {
        print('   → 结论：不要截。尾段贡献超过 5% 的晴空观测，截掉会重演 2024_0621 的 '
          + 'NO_OPTICAL；要么保持现状，要么按【改动28】把两场合并为一场。');
      } else {
        print('   → 结论：可以截。尾段几乎没带来新的晴空观测，'
          + '给本场指定 s2PostEnd = （后一场暴雨起点之前）即可消除标签混叠。');
      }
    }
  }

  var opticalFlood = mndwi.gt(MNDWI_THRESHOLD).unmask(0).and(s2Valid)
    .rename('Optical_Flood');
  var opticalNonWater = mndwi.lt(0).unmask(0).and(s2Valid)
    .rename('Optical_NonWater');

  // 口径提醒：逐景取 max 之后 MNDWI 整体上移，"非水体"（MNDWI < 0）这一条件更难满足，
  //   负样本（尤其 High Non-Flood）会明显减少——那些"窗口内出现过水体信号"的像元会退出训练集，
  //   属于口径变化带来的预期副作用，跨版本比面积/样本数时要一并考虑。

  // ----------------------------------------------------------
  // 4.6 DEM / 坡度 / JRC 永久水体
  // ----------------------------------------------------------
  var dem = ee.Image('USGS/SRTMGL1_003').clip(roi).rename('DEM');
  var slope = ee.Terrain.slope(dem).rename('slope');
  var lowSlope = slope.lt(SLOPE_LIMIT).unmask(0);

  var jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
    .select('occurrence')
    .clip(roi)
    .rename('JRC_occurrence');
  var permanentWater = jrc.gt(PERMANENT_WATER_TH).unmask(0);
  var nonPermanentWater = permanentWater.eq(0);

  // ----------------------------------------------------------
  // 4.7 伪标签：High / Medium Flood
  // ----------------------------------------------------------
  var highConfidenceFlood = sarFlood01
    .and(opticalFlood)
    .and(nonPermanentWater)
    .and(lowSlope)
    .rename('HighConfidenceFlood');

  var mediumConfidenceFlood = sarFlood01
    .and(s2Valid.not())
    .and(nonPermanentWater)
    .and(lowSlope)
    .rename('MediumConfidenceFlood');

  var highFlood01 = highConfidenceFlood.unmask(0);
  var mediumFlood01 = mediumConfidenceFlood.unmask(0);

  // ----------------------------------------------------------
  // 4.8 SAR 稳定区（相对全 ROI 差值中位数 ± tolerance）
  // ----------------------------------------------------------
  var vvMedian = ee.Number(
    vv_diff.updateMask(s1Valid).reduceRegion({
      reducer: ee.Reducer.median(),
      geometry: geom,
      scale: SAMPLE_SCALE,
      bestEffort: true,
      maxPixels: 1e10
    }).get('VV_diff')
  );
  var vhMedian = ee.Number(
    vh_diff.updateMask(s1Valid).reduceRegion({
      reducer: ee.Reducer.median(),
      geometry: geom,
      scale: SAMPLE_SCALE,
      bestEffort: true,
      maxPixels: 1e10
    }).get('VH_diff')
  );

  var vvStable = vv_diff.subtract(vvMedian).abs().lt(STABLE_TOLERANCE);
  var vhStable = vh_diff.subtract(vhMedian).abs().lt(STABLE_TOLERANCE);
  var sarStable01 = vvStable.unmask(0).and(vhStable.unmask(0))
    .and(s1Valid)
    .rename('SAR_Stable');

  // ----------------------------------------------------------
  // 4.9 伪标签：High / Medium Non-Flood（与洪水类互斥）
  // ----------------------------------------------------------
  var highConfidenceNonFlood = sarStable01
    .and(s2Valid)
    .and(opticalNonWater)
    .and(nonPermanentWater)
    .and(sarFlood01.not())
    .and(highFlood01.not())
    .and(mediumFlood01.not())
    .rename('HighConfidenceNonFlood');

  var mediumConfidenceNonFlood = sarStable01
    .and(s2Valid.not())
    .and(nonPermanentWater)
    .and(sarFlood01.not())
    .and(highFlood01.not())
    .and(mediumFlood01.not())
    .rename('MediumConfidenceNonFlood');

  if (NONFLOOD_REQUIRE_LOWSLOPE) {
    highConfidenceNonFlood = highConfidenceNonFlood.and(lowSlope);
    mediumConfidenceNonFlood = mediumConfidenceNonFlood.and(lowSlope);
  }

  // 冲突保护：万一某像元同时进入正负类，优先保留洪水证据
  var anyFlood01 = highFlood01.or(mediumFlood01);
  var highNonFlood01 = highConfidenceNonFlood.unmask(0).and(anyFlood01.not());
  var mediumNonFlood01 = mediumConfidenceNonFlood.unmask(0)
    .and(anyFlood01.not()).and(highNonFlood01.not());

  // ----------------------------------------------------------
  // 4.10【改动8】最终 label 与置信度来源（含正负冲突保护 + conf 分带）
  // ----------------------------------------------------------
  var floodUsed = USE_MEDIUM_AS_FLOOD ? anyFlood01 : highFlood01;
  var nonFloodUsed = (USE_MEDIUM_NONFLOOD
    ? highNonFlood01.or(mediumNonFlood01)
    : highNonFlood01).and(floodUsed.not());

  var knownArea = floodUsed.or(nonFloodUsed);

  var label = ee.Image(0)
    .where(floodUsed, 1)
    .updateMask(knownArea)
    .rename('label');

  // conf_flood: 2 = High Flood, 1 = Medium Flood, 0 = 非洪涝
  // conf_nonflood: 2 = High Non-Flood, 1 = Medium Non-Flood, 0 = 非非洪涝
  var confFlood = ee.Image(0)
    .where(mediumFlood01, 1)
    .where(highFlood01, 2)
    .unmask(0)
    .rename('conf_flood');
  var confNonFlood = ee.Image(0)
    .where(mediumNonFlood01, 1)
    .where(highNonFlood01, 2)
    .unmask(0)
    .rename('conf_nonflood');

  // ----------------------------------------------------------
  // 4.11 特征栈（波段名/顺序与原 temp.js 完全一致，下游脚本无需改）
  // ----------------------------------------------------------
  var featureStack = ee.Image.cat([
    vv_post.unmask(0),
    vh_post.unmask(0),
    vv_diff.unmask(0),
    vh_diff.unmask(0),
    vv_ratio.unmask(0),
    ndvi.unmask(0),
    mndwi.unmask(0),
    dem.unmask(0),
    slope.unmask(0),
    s2Valid.toFloat()
  ]).rename(FEATURE_NAMES).clip(roi);

  // label 保留掩膜 → Unknown 区域不会进入抽样
  var sampleImage = featureStack
    .addBands(label)
    .addBands(confFlood)
    .addBands(confNonFlood);

  // ----------------------------------------------------------
  // 4.12【改动9】每时段像元统计（一次 reduceRegion 取回全部计数）
  //   原 temp.js 是对 High Flood / Medium Flood / High Non-Flood 各做一次
  //   reduceRegion(count)，共 3 次；这里合并成 1 次多波段求和。
  // ----------------------------------------------------------
  var countImage = floodUsed.toInt().rename('n_flood')
    .addBands(nonFloodUsed.toInt().rename('n_nonflood'))
    .addBands(highFlood01.toInt().rename('n_high_flood'))
    .addBands(mediumFlood01.toInt().rename('n_medium_flood'))
    .addBands(highNonFlood01.toInt().rename('n_high_nonflood'))
    .addBands(mediumNonFlood01.toInt().rename('n_medium_nonflood'))
    .addBands(s2Valid.toInt().rename('n_s2valid'))
    // 【改动27】SAR 有效像元数（= 面积加权），作为 S2 覆盖率的分母，同一次 reduceRegion 取回
    .addBands(s1Valid.unmask(0).toInt().rename('n_valid'));

  var counts = countImage.reduceRegion({
    reducer: ee.Reducer.sum(),
    tileScale: 8,
    geometry: geom,
    scale: SAMPLE_SCALE,
    bestEffort: true,
    maxPixels: 1e10
  }).getInfo() || {};

  // ----------------------------------------------------------
  // 4.13某类像元不足时会硬抽，这里按各时段实际像元数动态取 min。
  // ----------------------------------------------------------
  var nFloodC = Math.round(Math.min(POINTS_PER_CLASS, counts.n_flood || 0));
  var nNonFloodC = Math.round(Math.min(POINTS_PER_CLASS, counts.n_nonflood || 0));

  var samples = ee.FeatureCollection([]);
  if (nFloodC > 0 && nNonFloodC > 0) {
    samples = sampleImage.stratifiedSample({
      numPoints: nFloodC + nNonFloodC,
      classBand: 'label',
      region: roi,
      scale: SAMPLE_SCALE,
      classValues: [0, 1],
      classPoints: [nNonFloodC, nFloodC],
      geometries: true,
      seed: SAMPLE_SEED,
      tileScale: 4
    });
  } else {
    print('⚠ ' + ev.name + '：正/负样本像元不足（flood='
      + nFloodC + ', nonflood=' + nNonFloodC + '），该时段跳过抽样。');
  }

  // 【改动11】样本属性：带上事件标识，便于按时间段/年份筛选与分层验证
  //   （原 temp.js 的样本没有事件/时间字段，多时段混在一个表里分不清来源）
  samples = samples.map(function (f) {
    return f.set({
      event_id: ev.name,
      year: ev.year,
      storm_start_bj: ev.start,
      storm_end_bj: ev.end,
      area: ev.area
    });
  });

  var nSamples = ee.Number(samples.size()).getInfo();

  print('像元统计(scale=' + SAMPLE_SCALE + 'm):', counts);
  print('该时段结果: 洪涝 ' + (counts.n_flood || 0)
    + ' 像元 / 非洪涝 ' + (counts.n_nonflood || 0)
    + ' 像元 / 样本 ' + nSamples + ' 条 | S2 有效像元 '
    + (counts.n_s2valid || 0));

  // 【改动22】QC 指标的两个量（都写进汇总表，19 个事件导出来一张表就能横向比）
  //   sensCommon：除 SAR 阈值以外的其余标签条件（与最终洪涝标签同一套，忽略 High/Medium 之分）
  var sensCommon = s1Valid.and(lowSlope).and(nonPermanentWater)
    .and(opticalFlood.or(s2Valid.not()));
  function nFloodAt(thr) {
    var candAt = vv_diff.lt(thr).and(vh_diff.lt(VH_THRESHOLD))
      .unmask(0).and(sensCommon);
    // 必须用 sum（与标签的 countImage.reduceRegion 口径一致）。
    // 注意两者的物理含义不同：sum 是"面积加权像元数"——部分覆盖的 100 m 像元按覆盖比例
    //   计入（本事件 1200.35）；而 count(selfMask()) 数的是"至少含一个洪水像元的网格数"
    //   （本事件 2001），后者会明显偏大，因为一个只覆盖 20% 的网格也被算作 1。
    return ee.Number(candAt.reduceRegion({
      reducer: ee.Reducer.sum(), geometry: geom,
      scale: SAMPLE_SCALE, bestEffort: true, maxPixels: 1e10}).values().get(0));
  }

  // ----------------------------------------------------------
  // 4.14 汇总行
  // ----------------------------------------------------------
  var summary = summaryBase(ev, w, avail, s2Source);
  summary.n_flood_px = counts.n_flood || 0;
  summary.n_nonflood_px = counts.n_nonflood || 0;
  summary.n_high_flood_px = counts.n_high_flood || 0;
  summary.n_medium_flood_px = counts.n_medium_flood || 0;
  summary.n_high_nonflood_px = counts.n_high_nonflood || 0;
  summary.n_medium_nonflood_px = counts.n_medium_nonflood || 0;
  summary.s2_valid_px = counts.n_s2valid || 0;
  // 【改动20】覆盖率与去偏量写进汇总表，便于追溯（有效区占比、扣掉的偏移量）
  summary.s1_valid_cover = s1Valid.reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geom, scale: 200,
    bestEffort: true, maxPixels: 1e9}).values().get(0);
  summary.debias_mode = DEBIAS_MODE;
  summary.vv_offset_db = vvOff;
  summary.vh_offset_db = vhOff;
  // 偏移离散度 = 后时相各景自身偏移的 max − min。
  //   >0.5 dB 说明两条轨道/日期的背景差得多，全局去偏不够用，该事件必须用 perImage。
  summary.offset_spread_db = ee.Number(postCorrCol.aggregate_max('vv_off_db'))
    .subtract(ee.Number(postCorrCol.aggregate_min('vv_off_db')));
  // 阈值敏感性：洪涝像元数在 -3.5 / -4.5 两档的比值（>1，越接近 1 越稳）
  var nSensLo = nFloodAt(-3.5);
  var nSensHi = nFloodAt(-4.5);
  summary.n_flood_at_m35 = nSensLo;
  summary.n_flood_at_m45 = nSensHi;
  summary.flood_sens_ratio = nSensLo.divide(nSensHi);
  // 【改动23】面积口径：n_flood_px 用的 sum 本身就是"面积加权像元数"（部分覆盖按比例计入），
  //   乘 0.01 km² 即得面积（本事件 1200.35 → 约 12.0 km²）。这里再用 pixelArea 直接算物理面积，
  //   二者互为校验，应该接近。valid_area_km2 是有效区（s1Valid = 1）的面积，作为占比的分母。
  summary.flood_area_km2 = floodUsed.unmask(0)
    .multiply(ee.Image.pixelArea()).divide(1e6)
    .reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: SAMPLE_SCALE,
      bestEffort: true, maxPixels: 1e10}).values().get(0);
  summary.valid_area_km2 = s1Valid.unmask(0)
    .multiply(ee.Image.pixelArea()).divide(1e6)
    .reduceRegion({reducer: ee.Reducer.sum(), geometry: geom, scale: SAMPLE_SCALE,
      bestEffort: true, maxPixels: 1e10}).values().get(0);
  summary.sample_count = nSamples;
  summary.status = (nSamples > 0) ? 'OK' : 'NO_SAMPLE';

  // ----------------------------------------------------------
  // 4.15【改动27】S2 光学覆盖质控（每场自动标记，不再靠人工比对）
  //   两个量都在 JS 侧算（counts 已经从一次 reduceRegion 取回，不额外增加阻塞调用）：
  //     s2_cover_valid_frac = S2 有效像元 / SAR 有效像元
  //     high_flood_share    = High / (High + Medium)，正样本的"光学背书纯度"
  //   标记规则：
  //     NO_OPTICAL     —— 覆盖率 < 5%，或正样本 High 占比 = 0（标签退化成纯 SAR 推断）
  //     LOW_S2_COVER   —— 覆盖率 < 50%，或 High 占比 < 30%（光学证据明显不足）
  //     OK             —— 其余
  //   注：`status` 列保持旧语义（OK / NO_SAMPLE / SKIPPED_NO_S1）不变，
  //       质控结果单独放 `s2_qc_flag`，这样新旧汇总表在 status 上仍可直接对照。
  // ----------------------------------------------------------
  var nValidPx = counts.n_valid || 0;
  var nFloodTot = counts.n_flood || 0;
  var s2CoverFrac = (nValidPx > 0) ? (counts.n_s2valid || 0) / nValidPx : 0;
  var highFloodShare = (nFloodTot > 0) ? (counts.n_high_flood || 0) / nFloodTot : 0;

  summary.n_valid_px = nValidPx;
  summary.s2_cover_valid_frac = s2CoverFrac;
  summary.high_flood_share = highFloodShare;

  var noOptical = (nFloodTot > 0)
    && (s2CoverFrac < NO_OPTICAL_COVER || highFloodShare === 0);
  var lowS2Cover = (s2CoverFrac < LOW_S2_COVER_MIN)
    || (nFloodTot > 0 && highFloodShare < MIN_HIGH_FLOOD_SHARE);
  summary.s2_qc_flag = noOptical ? 'NO_OPTICAL' : (lowS2Cover ? 'LOW_S2_COVER' : 'OK');

  if (noOptical || lowS2Cover) {
    print('⚠ ' + ev.name + '：S2 光学证据不足（s2_qc_flag = ' + summary.s2_qc_flag + '）'
      + '—— S2 有效覆盖 ' + (s2CoverFrac * 100).toFixed(1) + '%（阈值 '
      + (LOW_S2_COVER_MIN * 100) + '%）、正样本 High 占比 '
      + (highFloodShare * 100).toFixed(1) + '%（阈值 ' + (MIN_HIGH_FLOOD_SHARE * 100)
      + '%）。该事件的正样本多为"无光学背书"的 Medium Flood，标签语义与光学双确认事件不同，'
      + '建议核实 S2 源/窗口（看上面的 s2_source / s2_count / s2_sr_date 打印）后重跑，或单独剔除。');
  }

  // ----------------------------------------------------------
  // 4.16【改动22】诊断输出（DIAG = true 时才跑）
  //   正式跑数据保持 false；复核单个事件时打开，看四项：
  //   (1) 逐景偏移一览  —— QC：有无偏移离群的景、两条轨道差多少
  //   (2) 5 档阈值敏感性 —— 论文稳健性表（比值已进 summary，这里是全表）
  //   (3) 参考期基线检验 —— 论证"背景漂移真实存在"，换研究区/换季节时重跑
  //                         2025_0607 的结论备查：orbit 40 ≈ 0，orbit 113 ≈ −1.1 dB
  //   (4) 目视图层 —— 判断"去偏新增"像元的形态；三层是包含关系，一次只开一层看
  // ----------------------------------------------------------
  if (DIAG) {
    print(ev.name + ' 逐景偏移 [时间, 轨道, ΔVV]:', postCorrCol.map(function (im) {
      return ee.Feature(null, {
        t: im.get('t_bj'),
        orbit: im.get('orbit'),
        off_db: im.get('vv_off_db')
      });
    }));

    print(ev.name + ' VV 阈值敏感性（最终洪涝像元数）:', ee.FeatureCollection(
      [-3.0, -3.5, -4.0, -4.5, -5.0].map(function (t) {
        var candAt = vv_diff.lt(t).and(vh_diff.lt(VH_THRESHOLD))
          .unmask(0).and(sensCommon);
        return ee.Feature(null, {
          vv_thr: t,
          n_flood_px: candAt.reduceRegion({
            reducer: ee.Reducer.sum(), geometry: geom,
            scale: SAMPLE_SCALE, bestEffort: true, maxPixels: 1e10}).values().get(0)
        });
      })));

    print(ev.name + ' 参考期(无洪水)VV 中位差 [后一景 − 前一景]:', ee.FeatureCollection(
      s1preCol.aggregate_array('relativeOrbitNumber_start').distinct()
        .map(function (ob) {
          var col = s1preCol.filter(ee.Filter.eq('relativeOrbitNumber_start', ob))
            .sort('system:time_start');
          var early = ee.Image(col.first()).select('VV');
          var late = ee.Image(col.sort('system:time_start', false).first()).select('VV');
          return ee.Feature(null, {
            orbit: ob,
            n: col.size(),
            ref_median_diff_db: late.subtract(early).reduceRegion({
              reducer: ee.Reducer.median(), geometry: geom,
              scale: SAMPLE_SCALE, bestEffort: true, maxPixels: 1e10}).values().get(0)
          });
        })));

    var vvRaw = vv_diff.add(vvOff);
    var vhRaw = vh_diff.add(vhOff);
    var floodRawOnly = vvRaw.lt(VV_THRESHOLD).and(vhRaw.lt(VH_THRESHOLD))
      .unmask(0).and(s1Valid);
    Map.addLayer(floodRawOnly.selfMask(), {palette: ['yellow']}, '洪涝-不去偏');
    Map.addLayer(sarFlood01.selfMask(), {palette: ['red']}, '洪涝-去偏');
    // 新增像元只有几百个 100 m 像元，zoom 到 12 级以上才看得清；
    // 需要更醒目可以自己加膨胀，例如 .focal_max(2)
    Map.addLayer(sarFlood01.and(floodRawOnly.not()).selfMask(),
      {palette: ['magenta']}, '去偏新增');
  }

  return {
    name: ev.name,
    skipped: false,
    summary: summary,
    samples: samples,
    featureStack: featureStack,
    label: label,
    highConfidenceFlood: highConfidenceFlood,
    mediumConfidenceFlood: mediumConfidenceFlood,
    highConfidenceNonFlood: highConfidenceNonFlood,
    mediumConfidenceNonFlood: mediumConfidenceNonFlood,
    sarFlood: sarFlood,
    sarStable: sarStable01,
    mndwi: mndwi,
    s2Valid: s2Valid,
    s1_pre: s1_pre,
    s1_post: s1_post
  };
}

// ============================================================================
// 【改动31】把"本场 S2 后窗是否伸进后面某场暴雨"抽成一个可复用的小函数：
//   【改动29】的启动自检（下面 reportS2WindowOverlaps）用它打全表；buildEvent 里的
//   "越界尾段诊断"（4.5b）用同一条判定，避免两处各写一份、日后改一处忘一处。
//   返回 [] 或 [{name, startMs, startStr, overlapDays, s2StartMs, s2EndMs}, ...]
// ============================================================================
function s2WindowOverlapHits(ev) {
  var MS_DAY = 24 * 3600 * 1000;
  var aEnd = bjToUTC(ev.end).getTime();
  var aS2Start = ev.s2PostStart ? bjToUTC(ev.s2PostStart).getTime() : aEnd;
  var aS2End = ev.s2PostEnd ? bjToUTC(ev.s2PostEnd).getTime()
    : aEnd + S2_POST_PAD_DAYS * MS_DAY;
  var hits = [];
  for (var j = 0; j < EVENTS.length; j++) {
    var b = EVENTS[j];
    if (b.name === ev.name) continue;
    if (b.isControl) continue;      // 【改动33】对照事件不是暴雨，不参与越界判定
    var bStart = bjToUTC(b.start).getTime();
    // 只关心"在本场结束之后、且落在本场 S2 后窗之内"的其它暴雨起点
    if (bStart > aEnd && bStart < aS2End) {
      hits.push({
        name: b.name,
        startMs: bStart,
        startStr: b.start,
        overlapDays: (aS2End - bStart) / MS_DAY,
        s2StartMs: aS2Start,
        s2EndMs: aS2End
      });
    }
  }
  return hits;
}

// ============================================================================
// 【改动29】相邻暴雨的"S2 后窗越界"启动自检（纯 JS，不连 GEE，脚本加载时跑一次）
//   背景：2020_0628 / 2024_0621 都是靠**手工** s2PostEnd 躲开"下一场暴雨"的。这种"靠人记得"
//   的约束必然会有漏网的：Summary8 里就发现 2025_0522 的 S2 后窗（止于 2025-06-09）
//   已经伸进了 2025_0607 的暴雨时段（起于 2025-06-07），重叠 2.7 天，此前无人察觉。
//   而逐景 max 取的是窗口内的**峰值**，重叠就等于把后一场的水并进前一场的标签
//   （同一批像元被两个事件重复打标 → 标签混淆；若两场分处训练/验证两侧 → 训练集泄漏）。
//   这里把全部事件两两比一遍：凡"另一场的暴雨起点落在本场 S2 后窗之内"就报警。
//   处置：给前一场指定 s2PostEnd（截到后一场起点之前），或把两场合并为一场（见【改动28】）。
// ============================================================================
function reportS2WindowOverlaps() {
  var hits = [];
  // 【改动33】只对真正的暴雨事件做越界自检（对照事件排除在外，否则会误报）
  var stormEvents = EVENTS.filter(function (e) { return !e.isControl; });
  for (var i = 0; i < stormEvents.length; i++) {
    var a = stormEvents[i];
    s2WindowOverlapHits(a).forEach(function (h) {
      hits.push(a.name + ' 的 S2 后窗（止于 ' + isoDate(new Date(h.s2EndMs))
        + '）与 ' + h.name + '（起于 ' + h.startStr + '）重叠 '
        + h.overlapDays.toFixed(1) + ' 天');
    });
  }
  if (hits.length === 0) {
    print('【改动29】S2 后窗越界自检：未发现相邻暴雨窗口重叠。');
  } else {
    print('⚠ 【改动29】S2 后窗越界自检：发现 ' + hits.length
      + ' 处与下一场暴雨重叠——逐景 max 会把后一场的水并进前一场标签，'
      + '请给前一场指定 s2PostEnd（截到后一场起点之前）或把两场合并为一场。');
    hits.forEach(function (h) { print('   · ' + h); });
  }
}
reportS2WindowOverlaps();


// 5.【改动12】逐时段执行（原 temp.js 只执行一次 2016 事件）
var EVENTS_TO_RUN = EVENTS;
if (RUN_EVENT_NAMES !== null) {
  EVENTS_TO_RUN = EVENTS.filter(function (ev) {
    return RUN_EVENT_NAMES.indexOf(ev.name) !== -1;
  });
  print('仅运行指定时段:', RUN_EVENT_NAMES);
} else {
  // 【改动33】全量运行 = 只跑 18 场暴雨；对照事件（isControl）必须点名才跑，
  //   否则它们会混进汇总表、把"训练候选/仅验证"的划分搅乱。
  EVENTS_TO_RUN = EVENTS.filter(function (ev) { return !ev.isControl; });
  print('全量运行：暴雨事件 ' + EVENTS_TO_RUN.length + ' 场（对照事件需在 RUN_EVENT_NAMES 里点名）');
}

var results = EVENTS_TO_RUN.map(buildEvent);

// 合并所有时段的样本
var allSamples = ee.FeatureCollection([]);
results.forEach(function (r) {
  if (!r.skipped) {
    allSamples = allSamples.merge(r.samples);
  }
});

// 【改动12】每时段汇总表（降雨量 + 数据可用性 + 像元数 + 样本数）
var summaryFC = ee.FeatureCollection(results.map(function (r) {
  return ee.Feature(null, r.summary);
}));

print('========================================');
print('完成时段数: ' + results.length
  + ' | 其中有样本的时段: ' + results.filter(function (r) {
    return !r.skipped && r.summary.sample_count > 0;
  }).length);
print('所有时段合并样本总数:', allSamples.size());
print('按事件统计样本数:', allSamples.aggregate_histogram('event_id'));
print('按标签统计样本数:', allSamples.aggregate_histogram('label'));
print('每时段汇总表:', summaryFC);


// ============================================================================
// 6.【改动14】显示
//   原 temp.js 会一次性把所有可视化都加到 Map 上；这里逐时段运行，
//   只显示 VIEW_EVENT_NAME 指定的那一个时段，避免 19×10 个图层。
// ============================================================================
var viewOut = null;
results.forEach(function (r) {
  if (r.name === VIEW_EVENT_NAME && !r.skipped) {
    viewOut = r;
  }
});
if (!viewOut) {
  for (var i = 0; i < results.length; i++) {
    if (!results[i].skipped) { viewOut = results[i]; break; }
  }
}

if (viewOut) {
  Map.addLayer(viewOut.highConfidenceFlood.selfMask(),
    {palette: ['blue']}, viewOut.name + ' High Flood');
  Map.addLayer(viewOut.mediumConfidenceFlood.selfMask(),
    {palette: ['orange']}, viewOut.name + ' Medium Flood');
  Map.addLayer(viewOut.highConfidenceNonFlood.selfMask(),
    {palette: ['green']}, viewOut.name + ' High Non-Flood');
  Map.addLayer(viewOut.mediumConfidenceNonFlood.selfMask(),
    {palette: ['darkgreen']}, viewOut.name + ' Medium Non-Flood');
  Map.addLayer(viewOut.label,
    {min: 0, max: 1, palette: ['white', 'blue']},
    viewOut.name + ' Final Label');
  Map.addLayer(viewOut.s1_pre, {bands: ['VV'], min: -20, max: 0},
    viewOut.name + ' S1 Pre VV');
  Map.addLayer(viewOut.s1_post, {bands: ['VV'], min: -20, max: 0},
    viewOut.name + ' S1 Post VV');
  Map.addLayer(viewOut.mndwi, {min: -0.5, max: 0.8},
    viewOut.name + ' MNDWI');
  Map.addLayer(viewOut.samples, {}, viewOut.name + ' Samples');
} else {
  print('⚠ 没有可用时段可以在 Map 上显示。');
}


// 7.【改动13】导出
//   这里改为：每个时段一条单独 CSV + 1 条合并 CSV + 1 条每时段汇总表 CSV。
var EXPORT_ALL = true;         // 所有时段合并成一份 CSV（含 event_id / year）
var EXPORT_PER_EVENT = true;   // 每个时段单独一份 CSV（按时间段取数据用这个）
var EXPORT_SUMMARY = true;     // 每时段汇总表（降雨量 + 像元数 + 样本数）

if (EXPORT_ALL) {
  Export.table.toDrive({
    collection: allSamples,
    description: 'Wuhan_2016_2025_Flood_PseudoLabel_All',
    fileFormat: 'CSV',
    selectors: SAMPLE_SELECTORS
  });
}

if (EXPORT_SUMMARY) {
  Export.table.toDrive({
    collection: summaryFC,
    description: 'Wuhan_2016_2025_Flood_Event_Summary',
    fileFormat: 'CSV',
    selectors: SUMMARY_SELECTORS
  });
}

if (EXPORT_PER_EVENT) {
  results.forEach(function (r) {
    if (r.skipped || r.summary.sample_count === 0) {
      print('跳过导出（该时段无可用样本）: ' + r.name);
      return;
    }
    Export.table.toDrive({
      collection: r.samples,
      description: 'Flood_' + r.name,
      fileFormat: 'CSV',
      selectors: SAMPLE_SELECTORS
    });
  });
}
