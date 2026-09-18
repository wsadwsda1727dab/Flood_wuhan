
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
var POINTS_PER_CLASS = 2000;   // 每类最多抽样点数（实际取 min(该值, 该类像元数)）
var SAMPLE_SEED = 42;          // 抽样随机种子

// ---- 正负样本口径 ----
var USE_MEDIUM_AS_FLOOD = true;      // Medium Flood（无 S2 的 SAR 洪水）是否作为正样本
var USE_MEDIUM_NONFLOOD = true;      // Medium Non-Flood 是否作为负样本
var NONFLOOD_REQUIRE_LOWSLOPE = true;// 负样本是否同样要求低坡度（正负物理条件对称）

// ---- 时间窗口推导参数（天）----
var PRE_WINDOW_DAYS = 24;  // 事件前基线窗口长度
var PRE_GAP_DAYS = 5;      // 基线窗口结束 → 事件开始 之间的间隔
var POST_PAD_DAYS = 18;     // 【改动1】后窗口 = 事件结束 ~ 事件结束+POST_PAD_DAYS（只向后外扩）

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
  'area', 'rain_ref_mm', 'rainfall',
  's1_pre_count', 's1_post_count', 's2_source', 's2_count',
  'n_flood_px', 'n_nonflood_px', 'n_high_flood_px', 'n_medium_flood_px',
  'n_high_nonflood_px', 'n_medium_nonflood_px', 's2_valid_px',
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
//   preStart/preEnd/postStart/postEnd
//             可选，显式指定影像窗口（北京时间）。不写则按下面规则自动推导：
//               preEnd   = 事件开始 - PRE_GAP_DAYS
//               preStart = preEnd - PRE_WINDOW_DAYS
//               postStart= 事件开始 - POST_PAD_DAYS
//               postEnd  = 事件结束 + POST_PAD_DAYS
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
    rainRefMM: 50
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
    rainRefMM: 231.6
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
    name: 'Wuhan_2024_0621',
    year: 2024,
    start: '2024-06-21 07:00',
    end: '2024-06-22 07:00',
    area: '黄陂、东西湖、蔡甸、江夏、经开区',
    rain: '多个区24小时累计超100 mm',
    rainRefMM: 100
  },
  {
    name: 'Wuhan_2024_0628',
    year: 2024,
    start: '2024-06-28 03:00',
    end: '2024-06-28 12:00',
    area: '东西湖（长青街站）',
    rain: '东西湖长青街站147.8 mm',
    rainRefMM: 147.8,
    // 6月21–22日刚下过一场暴雨，基线窗口往前挪
    preStart: '2024-05-20 00:00',
    preEnd: '2024-06-10 00:00'
  },
  {
    name: 'Wuhan_2025_0522',
    year: 2025,
    start: '2025-05-22 00:00',
    end: '2025-05-22 16:00',
    area: '洪山区（理工大学站）',
    rain: '洪山理工大学站189 mm',
    rainRefMM: 189
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
  }
];

// 只跑部分时段：null = 跑 EVENTS 全部；
// 想单独取某一段数据时，例如：var RUN_EVENT_NAMES = ['Wuhan_2020_0705'];
var RUN_EVENT_NAMES = ['Wuhan_2025_0607'];

// Map 上显示哪个时段的结果（必须是 EVENTS 里的 name）
var VIEW_EVENT_NAME = ['Wuhan_2025_0607'];


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

// 计算某个事件的“事件前基线窗口”和“事件后窗口”
//从事件结束开始，并把 POST_PAD_DAYS 从 6 放到 18（12 天重访 + 余量）
function eventWindows(ev) {
  var startUTC = bjToUTC(ev.start);
  var endUTC = bjToUTC(ev.end);

  // var postStartJs = ev.postStart ? bjToUTC(ev.postStart)
  //   : addDays(startUTC, -POST_PAD_DAYS);
  // var postEndJs = ev.postEnd ? bjToUTC(ev.postEnd)
  //   : addDays(endUTC, POST_PAD_DAYS);
  var postStartJs = ev.postStart ? bjToUTC(ev.postStart) 
    : endUTC;
  var postEndJs   = ev.postEnd ? bjToUTC(ev.postEnd)
    : addDays(endUTC, POST_PAD_DAYS);
  var preEndJs = ev.preEnd ? bjToUTC(ev.preEnd)
    : addDays(startUTC, -PRE_GAP_DAYS);
  var preStartJs = ev.preStart ? bjToUTC(ev.preStart)
    : addDays(preEndJs, -PRE_WINDOW_DAYS);

  return {
    preStart: ee.Date(preStartJs),
    preEnd: ee.Date(preEndJs),
    postStart: ee.Date(postStartJs),
    postEnd: ee.Date(postEndJs),
    preStartStr: isoDate(preStartJs),
    preEndStr: isoDate(preEndJs),
    postStartStr: isoDate(postStartJs),
    postEndStr: isoDate(postEndJs),
    preDays: Math.round((preEndJs - preStartJs) / 86400000),
    postDays: Math.round((postEndJs - postStartJs) / 86400000)
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
    post_window_utc: w.postStartStr + ' ~ ' + w.postEndStr,
    pre_days: w.preDays,
    post_days: w.postDays,
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
  var s1postCol = getS1Collection(w.postStart, w.postEnd);

  // ----------------------------------------------------------
  // 4.2【改动6】Sentinel-2（L2A 优先，窗口内为 0 景时回退 L1C；另加云量过滤）
  //   原 temp.js 只用 COPERNICUS/S2_SR_HARMONIZED，且不按云量筛选，
  //   2016 年没有 L2A 产品 → 原脚本 2016 时段拿不到任何 S2。
  // ----------------------------------------------------------
  function maskS2(image) {
    var qa = image.select('QA60');
    var clear = qa.bitwiseAnd(1 << 10).eq(0)
      .and(qa.bitwiseAnd(1 << 11).eq(0));
    return image.updateMask(clear);
  }

  function getS2Collection(id) {
    return ee.ImageCollection(id)
      .filterBounds(roi)
      .filterDate(w.postStart, w.postEnd)
      .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', S2_MAX_CLOUD))
      .map(maskS2);
  }

  var s2srCol = getS2Collection('COPERNICUS/S2_SR_HARMONIZED');
  var s2l1cCol = getS2Collection('COPERNICUS/S2_HARMONIZED');

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
      .filterDate(ee.Date(bjToUTC(ev.end)), w.postEnd).size(),
    s1_post_after_dates: s1postCol
      .filterDate(ee.Date(bjToUTC(ev.end)), w.postEnd)
      .aggregate_array('system:time_start').map(fmtBjDateTime),
    s2_sr_count: s2srCol.size(),
    s2_l1c_count: s2l1cCol.size(),
    // S2 也打印日期：光学证据取自后窗口的哪几天
    s2_sr_dates: s2srCol.aggregate_array('system:time_start')
      .map(fmtBjDateTime),
    s2_l1c_dates: s2l1cCol.aggregate_array('system:time_start')
      .map(fmtBjDateTime)
  }).getInfo();

  var s2Source = 'NONE';
  var s2Col = s2srCol;
  if (avail.s2_sr_count > 0) {
    s2Source = 'S2_SR_HARMONIZED(L2A)';
    s2Col = s2srCol;
  } else if (avail.s2_l1c_count > 0) {
    s2Source = 'S2_HARMONIZED(L1C/TOA)';
    s2Col = s2l1cCol;
  }

  print('────────── ' + ev.name + '（' + ev.year + '）──────────');
  print('暴雨时段(北京时): ' + ev.start + ' ~ ' + ev.end + ' | ' + ev.area);
  print('影像窗口(UTC): 事件前 ' + w.preStartStr + ' ~ ' + w.preEndStr
    + '（' + w.preDays + '天）; 事件后 ' + w.postStartStr + ' ~ '
    + w.postEndStr + '（' + w.postDays + '天）');
  print('数据可用性:', avail);
  print('S2 数据源: ' + s2Source);

  // 后时相审计：后窗口有影像、但没有一景晚于事件结束
  if (avail.s1_post_after_count === 0 && avail.s1_post_count > 0) {
    print('⚠ ' + ev.name + '：后窗口内有 ' + avail.s1_post_count
      + ' 景 S1，但全部早于/等于事件结束 → 后时相不代表洪水状态，'
      + '该时段伪标签不可靠。');
    print('   建议：为该事件手工指定 postEnd（事件结束后 12~18 天），'
      + '或增大 POST_PAD_DAYS。');
  }

  if (avail.s1_pre_count === 0 || avail.s1_post_count === 0) {
    print('⚠ ' + ev.name + '：事件前或事件后窗口内没有 S1 影像，跳过该时段'
      + '（可增大 POST_PAD_DAYS 或调整窗口后重跑）。');
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
  var s1_pre = s1preCol.median().clip(roi);
  // var s1_post = s1postCol.first().clip(roi);
  
  // var t0 = ee.Date(s1postCol.aggregate_min('system:time_start'));
  // var s1_post = s1postCol
  //   .filterDate(t0, t0.advance(1, 'day'))
  //   .median().clip(roi);
    
  var t0 = ee.Date(s1postCol.aggregate_min('system:time_start'));
  var s1_post = s1postCol
    .filterDate(t0, t0.advance(8, 'day'))   
    .map(function (im) { return im.updateMask(im.gt(-50)); })
    .median().clip(roi);

  var vv_pre = s1_pre.select('VV').rename('VV_pre');
  var vh_pre = s1_pre.select('VH').rename('VH_pre');
  var vv_post = s1_post.select('VV').rename('VV');
  var vh_post = s1_post.select('VH').rename('VH');

  //前后时相同时有效的像元（避免把“无 SAR 数据”当成稳定区/非洪涝）
  var s1Valid = vv_pre.mask().and(vh_pre.mask())
    .and(vv_post.mask()).and(vh_post.mask())
    .unmask(0);

  var vv_diff = vv_post.subtract(vv_pre).rename('VV_diff');
  var vh_diff = vh_post.subtract(vh_pre).rename('VH_diff');

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

 
  // 4.5 光学证据
  // ----------------------------------------------------------
  var s2 = s2Col.median().clip(roi);

  var s2Valid = s2.select('B3').mask().unmask(0).gt(0).rename('S2_Valid');
  var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('MNDWI');

  var opticalFlood = mndwi.gt(MNDWI_THRESHOLD).unmask(0).and(s2Valid)
    .rename('Optical_Flood');
  var opticalNonWater = mndwi.lt(0).unmask(0).and(s2Valid)
    .rename('Optical_NonWater');

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
    .addBands(s2Valid.toInt().rename('n_s2valid'));

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
  summary.sample_count = nSamples;
  summary.status = (nSamples > 0) ? 'OK' : 'NO_SAMPLE';
  
  
  print('A s1_post 的 mask 覆盖:', s1_post.select('VV').mask().unmask(0).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geom, scale: 100, bestEffort: true, maxPixels: 1e9}));
  print('B s1_post 中 VV==0（未掩膜）占比:', s1_post.select('VV').eq(0).selfMask().reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geom, scale: 100, bestEffort: true, maxPixels: 1e9}));
  print('C vv_post 的 mask 覆盖:', vv_post.mask().unmask(0).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: geom, scale: 100, bestEffort: true, maxPixels: 1e9}));
   

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


// 5.【改动12】逐时段执行（原 temp.js 只执行一次 2016 事件）
var EVENTS_TO_RUN = EVENTS;
if (RUN_EVENT_NAMES !== null) {
  EVENTS_TO_RUN = EVENTS.filter(function (ev) {
    return RUN_EVENT_NAMES.indexOf(ev.name) !== -1;
  });
  print('仅运行指定时段:', RUN_EVENT_NAMES);
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

// if (EXPORT_ALL) {
//   Export.table.toDrive({
//     collection: allSamples,
//     description: 'Wuhan_2016_2025_Flood_PseudoLabel_All',
//     fileFormat: 'CSV',
//     selectors: SUMMARY_SELECTORS   
//   });
// }

// if (EXPORT_SUMMARY) {
//   Export.table.toDrive({
//     collection: summaryFC,
//     description: 'Wuhan_2016_2025_Flood_Event_Summary',
//     fileFormat: 'CSV',
//     selectors: SAMPLE_SELECTORS   
//   });
// }

// if (EXPORT_PER_EVENT) {
//   results.forEach(function (r) {
//     if (r.skipped || r.summary.sample_count === 0) {
//       print('跳过导出（该时段无可用样本）: ' + r.name);
//       return;
//     }
//     Export.table.toDrive({
//       collection: r.samples,
//       description: 'Flood_' + r.name,
//       fileFormat: 'CSV',
//       selectors: SAMPLE_SELECTORS   
//     });
//   });
// }