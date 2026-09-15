// ============================================================================
// 多年份 / 多事件洪涝 RF 训练样本批量生成器（GEE Code Editor 版）
//
// 思路：
//   1) 对 EVENTS 中的每一个事件，各自读取 S1 前后时相 + S2（优先 L2A SR，
//      无数据时自动回退 L1C）+ DEM/JRC；
//   2) 用同一套规则生成 High / Medium / Non-Flood 伪标签；
//   3) 每个事件输出“统一特征栈 + 伪标签样本”，并加上 event_id / year；
//   4) 合并所有事件样本，导出 CSV 作为 RF 的训练数据；
//   5) 可选：直接在本脚本内训练 RF，并对留出事件做精度验证 + 整幅预测。
//
// 与原始脚本相比已修复 / 调整：
//   - 删除无意义的 VV_ratio（原来是 VV_diff 的复制）；
//   - 特征波段先 unmask 再抽样，Medium（无 S2）像素不再被 dropNulls 丢掉；
//   - 加入 S2_valid 指示带，模型可区分“真实 0 值”与“无 S2 填充”；
//   - 抽样点数按每类实际像元数动态取 min，类不足时不会硬抽 2000；
//   - Non-Flood 可选与 Flood 一样限制低坡度；
//   - S1 可选按 relativeOrbitNumber 约束同轨道。
// ============================================================================

// ---------------------------------------------------------------------------
// 0. 全局配置
// ---------------------------------------------------------------------------

var DEFAULT_ROI = ee.FeatureCollection(
  'projects/studied-glow-475306-v5/assets/wuhan');

// 每个事件的参数。要批量处理多少年，就在这里加多少条。
// 同一函数同样适用于不同研究区：在事件里写 roi 字段即可覆盖 DEFAULT_ROI。
var EVENTS = [
  {
    name: 'Wuhan_2016',
    year: 2016,
    roi: DEFAULT_ROI,
    preStart: '2016-05-20',
    preEnd:   '2016-06-10',
    postStart:'2016-07-05',
    postEnd:  '2016-07-25',
    vvThreshold: -4.0,
    vhThreshold: -3.5,
    s1RelativeOrbit: null,  // 填具体轨道号则强制同轨；null = 不做轨道过滤
    seed: 42
  }
  // 示例：继续添加其他事件（可换年份，也可换区域）
  // {
  //   name: 'Wuhan_2020',
  //   year: 2020,
  //   roi: DEFAULT_ROI,
  //   preStart: '2020-06-01',
  //   preEnd:   '2020-06-25',
  //   postStart:'2020-07-10',
  //   postEnd:  '2020-08-05',
  //   vvThreshold: -4.0,
  //   vhThreshold: -3.5,
  //   s1RelativeOrbit: null,
  //   seed: 43
  // }
];

// 每类最多抽样点数（最终点数 = min(该值, 实际可用像元数)）
var POINTS_PER_CLASS = 1500;
var SAMPLE_SCALE = 30;

// 是否把 Medium Confidence（无 S2、纯 SAR 证据）并入正样本。
// true  = label=1 包含 High+Medium；
// false = 只有 High 才作为正样本，Medium 区域保持 Unknown。
var USE_MEDIUM_AS_FLOOD = true;

// 是否让 Non-Flood 与 Flood 一样要求低坡度（推荐 true，保证正负样本物理条件可比）
var NONFLOOD_REQUIRE_LOWSLOPE = true;

// S2 整景云量上限（%）。L2A 优先，若窗口内 L2A 为 0 景则自动回退到 L1C。
var S2_MAX_CLOUD = 90;

// 伪标签规则参数
var OPTICAL_MNDWI_TH = 0.2;   // MNDWI 水体阈值
var SLOPE_LIMIT = 5;          // 低坡度阈值（度）
var STABLE_TOLERANCE = 1.5;   // SAR 稳定区容差（dB）
var PERMANENT_WATER_TH = 90;  // JRC occurrence 永久水体阈值（%）

// 无 S2 区域的光谱填充值（配合 S2_valid=0 使用，避免 RF 出现缺失值）
var NDVI_FILL = 0;
var MNDWI_FILL = 0;

// 统一的 RF 特征模板（所有事件必须完全一致，训练/预测才能共用）
var FEATURES = [
  'VV_pre', 'VH_pre', 'VV_post', 'VH_post',
  'VV_diff', 'VH_diff',
  'NDVI', 'MNDWI', 'S2_valid',
  'DEM', 'slope', 'JRC_occ'
];

// 导出任务名
var EXPORT_DESCRIPTION = 'MultiYear_Flood_RF_Training';

// ------- RF 训练 / 验证（可选项）-------
// 至少要有 2 个事件，并把 RUN_RF 改为 true。
var RUN_RF = false;
var TEST_EVENT_NAME = 'Wuhan_2020'; // 留出验证的事件名，必须在 EVENTS 中存在
var RF_TREES = 100;

// ---------------------------------------------------------------------------
// 1. 通用工具函数
// ---------------------------------------------------------------------------

// S1 集合：IW + VV/VH，可选同相对轨道
function getS1Collection(roi, start, end, relativeOrbit) {
  var col = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(roi)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH']);

  if (relativeOrbit !== null && relativeOrbit !== undefined) {
    col = col.filter(ee.Filter.eq('relativeOrbitNumber', relativeOrbit));
  }
  return col;
}

// S2 云掩膜（QA60 bit10/bit11，0 表示清晰）
function maskS2(image) {
  var qa = image.select('QA60');
  var clear = qa.bitwiseAnd(1 << 10).eq(0)
    .and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(clear);
}

// 光学集合：优先 L2A SR；若窗口内为 0 景，自动回退 L1C TOA。
// 注意：两套数据都只用于 NDVI/MNDWI 这类比值指数，尺度差异不影响。
function getOptical(roi, start, end, maxCloud) {
  var l2a = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate(start, end)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', maxCloud));

  var l1c = ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
    .filterBounds(roi)
    .filterDate(start, end)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', maxCloud));

  var source = ee.ImageCollection(
    ee.Algorithms.If(l2a.size().gt(0), l2a, l1c));

  return {
    source: source.map(maskS2),
    l2aCount: l2a.size(),
    l1cCount: l1c.size()
  };
}

// 计算某二值掩膜影像中“值为 1 的像元”的数量（服务器对象）
function countOnes(maskImage, geom) {
  return ee.Number(
    maskImage.selfMask().reduceRegion({
      reducer: ee.Reducer.count(),
      geometry: geom,
      scale: SAMPLE_SCALE,
      maxPixels: 1e10,
      bestEffort: true
    }).values().get(0)
  );
}

// ---------------------------------------------------------------------------
// 2. 单事件：统一特征栈 + 伪标签 + 训练样本
// ---------------------------------------------------------------------------

function buildEvent(event) {
  var roi = event.roi || DEFAULT_ROI;
  var geom = roi.geometry();
  var vvThreshold = event.vvThreshold || -4.0;
  var vhThreshold = event.vhThreshold || -3.5;

  // ---------------- 2.1 S1 前后时相 ----------------
  var s1preCol = getS1Collection(
    roi, event.preStart, event.preEnd, event.s1RelativeOrbit);
  var s1postCol = getS1Collection(
    roi, event.postStart, event.postEnd, event.s1RelativeOrbit);

  var s1pre = s1preCol.median().clip(roi);
  var s1post = s1postCol.median().clip(roi);

  var vv_pre = s1pre.select('VV').rename('VV_pre');
  var vh_pre = s1pre.select('VH').rename('VH_pre');
  var vv_post = s1post.select('VV').rename('VV_post');
  var vh_post = s1post.select('VH').rename('VH_post');

  var vv_diff = vv_post.subtract(vv_pre).rename('VV_diff');
  var vh_diff = vh_post.subtract(vh_pre).rename('VH_diff');

  // 前后时相同时有效的像元（防止把“无 SAR 数据”误当成稳定区）
  var s1Valid = vv_pre.mask().and(vh_pre.mask())
    .and(vv_post.mask()).and(vh_post.mask())
    .unmask(0);

  var sarFlood01 = vv_diff.lt(vvThreshold)
    .and(vh_diff.lt(vhThreshold))
    .unmask(0).and(s1Valid);

  // ---------------- 2.2 S2 光学证据 ----------------
  var opt = getOptical(roi, event.postStart, event.postEnd, S2_MAX_CLOUD);
  var s2 = opt.source.median().clip(roi);

  // S2 有效区：B3 有值即为 1（先 unmask 再比较，避免“空集合”传播掩膜）
  var s2Valid = s2.select('B3').mask().unmask(0).gt(0)
    .rename('S2_valid');

  var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('MNDWI');

  // MNDWI > 阈值 且 有 S2 = 光学水体
  var opticalFlood = mndwi.gt(OPTICAL_MNDWI_TH).unmask(0).and(s2Valid);
  // MNDWI < 0 且 有 S2 = 光学非水体
  var opticalNonWater = mndwi.lt(0).unmask(0).and(s2Valid);
  // 非洪涝的光学条件：明确非水体，或根本没有 S2
  var nonFloodOptical = opticalNonWater.or(s2Valid.not());

  // ---------------- 2.3 DEM / 坡度 / JRC ----------------
  var dem = ee.Image('USGS/SRTMGL1_003').clip(roi).rename('DEM');
  var slope = ee.Terrain.slope(dem).rename('slope');
  var lowSlope = slope.lt(SLOPE_LIMIT).unmask(0);

  var jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
    .select('occurrence')
    .clip(roi)
    .rename('JRC_occ');
  var permanentWater = jrc.gt(PERMANENT_WATER_TH).unmask(0);
  var nonPermanent = permanentWater.eq(0);

  // ---------------- 2.4 伪标签分级 ----------------
  // High：SAR + 光学 + 非永久水 + 低坡度
  var highFlood = sarFlood01.and(opticalFlood)
    .and(nonPermanent).and(lowSlope);
  // Medium：SAR + 无 S2 + 非永久水 + 低坡度（仅 SAR 证据）
  var mediumFlood = sarFlood01.and(s2Valid.not())
    .and(nonPermanent).and(lowSlope);

  var high01 = highFlood.unmask(0);
  var medium01 = mediumFlood.unmask(0);

  // ---------------- 2.5 SAR 稳定区（用于 Non-Flood） ----------------
  var vvMedian = ee.Number(
    vv_diff.reduceRegion({
      reducer: ee.Reducer.median(),
      geometry: geom,
      scale: SAMPLE_SCALE,
      maxPixels: 1e10,
      bestEffort: true
    }).get('VV_diff')
  );
  var vhMedian = ee.Number(
    vh_diff.reduceRegion({
      reducer: ee.Reducer.median(),
      geometry: geom,
      scale: SAMPLE_SCALE,
      maxPixels: 1e10,
      bestEffort: true
    }).get('VH_diff')
  );

  var vvStable01 = vv_diff.subtract(vvMedian).abs()
    .lt(STABLE_TOLERANCE).unmask(0).and(s1Valid);
  var vhStable01 = vh_diff.subtract(vhMedian).abs()
    .lt(STABLE_TOLERANCE).unmask(0).and(s1Valid);
  var sarStable01 = vvStable01.and(vhStable01);

  // High Non-Flood：SAR 稳定 + 非永久水 + 光学非水体（或无 S2）
  //                 + 与所有洪涝类互斥；可选限制低坡度
  var highNonFlood = sarStable01.and(nonPermanent)
    .and(nonFloodOptical)
    .and(sarFlood01.not())
    .and(high01.not())
    .and(medium01.not());

  if (NONFLOOD_REQUIRE_LOWSLOPE) {
    highNonFlood = highNonFlood.and(lowSlope);
  }
  var nonFlood01 = highNonFlood.unmask(0);

  // ---------------- 2.6 最终 label ----------------
  var flood01 = (USE_MEDIUM_AS_FLOOD ? high01.or(medium01) : high01);
  var known01 = flood01.or(nonFlood01);

  var label = ee.Image(0)
    .where(flood01, 1)
    .updateMask(known01)
    .rename('label');

  // label_src 记录来源：2=High Flood, 1=Medium Flood, 0=Non-Flood
  var floodSrc = high01.multiply(2).add(medium01.multiply(1));
  var labelSrc = floodSrc.where(nonFlood01, 0)
    .updateMask(known01)
    .rename('label_src');

  // ---------------- 2.7 统一特征栈 ----------------
  // 所有特征先 unmask 填充，保证 RF 无缺失值；
  // label / label_src 保留掩膜，Unknown 仍不会参与抽样。
  var featBands = [
    vv_pre.unmask(0),
    vh_pre.unmask(0),
    vv_post.unmask(0),
    vh_post.unmask(0),
    vv_diff.unmask(0),
    vh_diff.unmask(0),
    ndvi.unmask(NDVI_FILL),
    mndwi.unmask(MNDWI_FILL),
    s2Valid.toFloat(),
    dem.unmask(0),
    slope.unmask(0),
    jrc.unmask(0)
  ];
  var featureStack = ee.Image.cat(featBands).rename(FEATURES);

  var sampleImage = featureStack.addBands([label, labelSrc]);

  // ---------------- 2.8 各类像元数与抽样 ----------------
  var nFlood = countOnes(label.eq(1), geom);
  var nNonFlood = countOnes(label.eq(0), geom);

  // 打印每个事件的诊断信息
  print('======== Event:', event.name, '========');
  print('S1 pre images:', s1preCol.size());
  print('S1 post images:', s1postCol.size());
  print('S2 L2A / L1C images:', opt.l2aCount, '/', opt.l1cCount);
  print('Flood known pixels:', nFlood);
  print('Non-flood known pixels:', nNonFlood);

  // 取客户端实际数值，决定每类抽样数（不足则少抽，不报错）
  var nFloodC = Math.min(POINTS_PER_CLASS, ee.Number(nFlood).getInfo());
  var nNonFloodC = Math.min(POINTS_PER_CLASS, ee.Number(nNonFlood).getInfo());

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
      seed: event.seed || 1,
      tileScale: 4
    });
  } else {
    print('警告：', event.name,
      '洪涝或非洪涝类可用像元为 0，跳过该事件抽样。');
  }

  // 给样本加上事件属性，便于后续按年份分层/留出验证
  samples = samples.map(function (f) {
    return f.set({
      event_id: event.name,
      year: event.year
    });
  });

  print(event.name, 'samples:', samples.size());
  print(event.name, 'label histogram:',
    samples.aggregate_histogram('label'));

  return {
    name: event.name,
    samples: samples,
    label: label,
    labelSrc: labelSrc,
    featureStack: featureStack,
    highFlood: high01,
    mediumFlood: medium01,
    nonFlood: nonFlood01,
    s2Valid: s2Valid,
    s2Collection: opt.source
  };
}

// ---------------------------------------------------------------------------
// 3. 批量执行：遍历所有事件，合并样本
// ---------------------------------------------------------------------------

var eventOutputs = {};
var allSamples = ee.FeatureCollection([]);

EVENTS.forEach(function (ev) {
  var out = buildEvent(ev);
  eventOutputs[ev.name] = out;
  allSamples = allSamples.merge(out.samples);
});

print('----------------------------------------');
print('Total training samples:', allSamples.size());
print('By label:', allSamples.aggregate_histogram('label'));
print('By event:', allSamples.aggregate_histogram('event_id'));

// 可选：直接在本脚本里查看某事件的伪标签图
var showEvent = EVENTS[0];
var showOut = eventOutputs[showEvent.name];
Map.centerObject(showEvent.roi || DEFAULT_ROI, 9);
Map.addLayer(showOut.highFlood.selfMask(), {palette: ['blue']},
  showEvent.name + ' High Flood');
Map.addLayer(showOut.mediumFlood.selfMask(), {palette: ['orange']},
  showEvent.name + ' Medium Flood');
Map.addLayer(showOut.nonFlood.selfMask(), {palette: ['green']},
  showEvent.name + ' Non-Flood');

// 导出合并样本（CSV：含特征列 + label + label_src + event_id + year + .geo）
Export.table.toDrive({
  collection: allSamples,
  description: EXPORT_DESCRIPTION,
  fileFormat: 'CSV'
});

// ---------------------------------------------------------------------------
// 4.（可选）RF 训练 + 留出事件验证 + 全图预测
//    至少配置 2 个事件，并把 RUN_RF 设为 true 才会执行。
// ---------------------------------------------------------------------------

if (RUN_RF) {
  if (!(TEST_EVENT_NAME in eventOutputs)) {
    throw new Error('TEST_EVENT_NAME 不在 EVENTS 中: ' + TEST_EVENT_NAME);
  }

  var trainSamples = allSamples.filter(
    ee.Filter.neq('event_id', TEST_EVENT_NAME));
  var testSamples = allSamples.filter(
    ee.Filter.eq('event_id', TEST_EVENT_NAME));

  print('RF train samples:', trainSamples.size());
  print('RF test samples:', testSamples.size());

  var rf = ee.Classifier.smileRandomForest(RF_TREES).train({
    features: trainSamples,
    classProperty: 'label',
    inputProperties: FEATURES
  });

  // 在留出事件自己的训练样本上做年度外精度检验
  var testPred = testSamples.classify(rf, 'pred');
  var matrix = testPred.errorMatrix('label', 'pred');
  print('Out-of-event confusion matrix:', matrix);
  print('Out-of-event overall accuracy:', matrix.accuracy());

  // 对留出事件做整幅预测并显示
  var target = eventOutputs[TEST_EVENT_NAME];
  var predImage = target.featureStack.classify(rf).rename('flood_pred');
  var floodVis = predImage.eq(1).selfMask();
  Map.addLayer(floodVis, {palette: ['red']},
    TEST_EVENT_NAME + ' RF Flood Prediction');

  // 如需导出预测栅格，可取消下一行注释
  // Export.image.toDrive({
  //   image: predImage,
  //   description: TEST_EVENT_NAME + '_RF_Flood',
  //   region: (eventOutputs[TEST_EVENT_NAME].samples.geometry()),
  //   scale: SAMPLE_SCALE,
  //   maxPixels: 1e10
  // });
}
