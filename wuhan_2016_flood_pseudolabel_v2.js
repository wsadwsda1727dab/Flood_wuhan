// ============================================================
// 武汉市 2016 年洪涝事件 —— 多源证据伪标签（修正版 v2）
//
// 本版在保持原有 FloodMap(roi) 结构与变量命名的基础上修改：
//   1) VV_ratio 由“dB 相除”改为“转线性功率后相除”，具有物理意义；
//   2) 特征波段先 unmask 再抽样，Medium（无 S2）样本不再被 dropNulls 丢弃；
//   3) 增加 S2_Valid 特征，模型可区分“真实 0”和“无 S2 填充”；
//   4) 正负样本证据等级对称：无 S2 区域的 Non-Flood 降为中置信（可配置）；
//   5) 抽样点数按实际像元数动态取值，类不足时不会硬抽 2000 而报错；
//   6) 导出 label_src / conf 信息与 train-val 划分列，便于后续精度评价；
//   7) S1 可选同相对轨道（S1_RELATIVE_ORBIT）。
//
// 注意：本脚本用于“生成伪标签与训练样本”，RF 训练/精度评价是下一步。
// ============================================================

// 1. 研究区
var wuhan = ee.FeatureCollection("projects/studied-glow-475306-v5/assets/wuhan");
var roi = wuhan;

Map.centerObject(roi, 9);
Map.addLayer(roi, {color: 'black'}, 'Wuhan');

// 2. 洪涝事件时间
var preStart = '2016-05-20';
var preEnd   = '2016-06-10';
var postStart = '2016-07-05';
var postEnd   = '2016-07-25';

// ------------------------------------------------------------
// 2.1 可配置参数
// ------------------------------------------------------------
// S1 相对轨道：填数字（如 127）则前后时相都只用该轨道；null = 不限制。
// 建议先看 Console 打印的 pre/post 轨道直方图，再决定是否固定。
var S1_RELATIVE_ORBIT = null;

// 每类最多抽取的点数（实际取 min(该值, 该类已知像元数)）
var MAX_POINTS_PER_CLASS = 2000;

// 伪标签是否纳入中置信类别（建议先 true 跑通，再对比 false 的结果）
var USE_MEDIUM_AS_FLOOD = true;      // Medium Flood（无 S2 的 SAR 洪水）是否作为正样本
var USE_MEDIUM_NONFLOOD = true;      // Medium Non-Flood（无 S2 的 SAR 稳定区）是否作为负样本

// Non-Flood 是否与 Flood 一样要求低坡度，保证正负样本物理条件可比
var NONFLOOD_REQUIRE_LOWSLOPE = true;

// SAR 稳定区判定：false = 相对全 ROI 差值中位数 ± tolerance；
//                  true  = 绝对变化 ± ABS_STABLE_TOLERANCE（更直观，可对比实验）
var USE_ABSOLUTE_STABLE = false;
var STABLE_TOLERANCE = 1.5;
var ABS_STABLE_TOLERANCE = 1.5;

// 阈值
var vvThreshold = -4.0;
var vhThreshold = -3.5;
var MNDWI_THRESHOLD = 0.2;
var SLOPE_LIMIT = 5;

// 特征波段名（RF 训练与预测必须保持一致）
var FEATURE_NAMES = [
  'VV', 'VH', 'VV_diff', 'VH_diff', 'VV_ratio',
  'NDVI', 'MNDWI', 'DEM', 'slope', 'S2_Valid'
];

// ============================================================
// 3. FloodMap 主函数
// ============================================================
var FloodMap = function (roi) {

  // ----------------------------------------------------------
  // 3.1 Sentinel-1 SAR 数据
  // ----------------------------------------------------------
  function getS1Collection(start, end) {
    var col = ee.ImageCollection('COPERNICUS/S1_GRD')
      .filterBounds(roi)
      .filterDate(start, end)
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
      .select(['VV', 'VH']);

    if (S1_RELATIVE_ORBIT !== null && S1_RELATIVE_ORBIT !== undefined) {
      col = col.filter(ee.Filter.eq('relativeOrbitNumber', S1_RELATIVE_ORBIT));
    }
    return col;
  }

  function getS1(start, end) {
    return getS1Collection(start, end).median().clip(roi);
  }

  var s1preCol = getS1Collection(preStart, preEnd);
  var s1postCol = getS1Collection(postStart, postEnd);

  print('S1 pre image count:', s1preCol.size());
  print('S1 post image count:', s1postCol.size());
  // 用于检查前后是否混了不同轨道（若混轨，建议设置 S1_RELATIVE_ORBIT）
  print('S1 pre orbit histogram:',
    s1preCol.aggregate_histogram('relativeOrbitNumber'));
  print('S1 post orbit histogram:',
    s1postCol.aggregate_histogram('relativeOrbitNumber'));
  print('S1 pre dates:', s1preCol.aggregate_array('system:time_start')
    .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); }));
  print('S1 post dates:', s1postCol.aggregate_array('system:time_start')
    .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); }));

  var s1_pre = getS1(preStart, preEnd);
  var s1_post = getS1(postStart, postEnd);

  print('S1 pre:', s1_pre);
  print('S1 post:', s1_post);

  // ----------------------------------------------------------
  // 3.2 VV / VH
  // ----------------------------------------------------------
  var vv_pre = s1_pre.select('VV').rename('VV_pre');
  var vv_post = s1_post.select('VV').rename('VV');
  var vh_pre = s1_pre.select('VH').rename('VH_pre');
  var vh_post = s1_post.select('VH').rename('VH');

  // 前后时相同时有效的像元（防止把“无 SAR 数据”误判为稳定区）
  var s1Valid = vv_pre.mask().multiply(vh_pre.mask())
    .multiply(vv_post.mask()).multiply(vh_post.mask())
    .unmask(0);

  // ----------------------------------------------------------
  // 3.3 SAR 变化特征
  // ----------------------------------------------------------
  var vv_diff = vv_post.subtract(vv_pre).rename('VV_diff');   // dB 差值 = 对数比值
  var vh_diff = vh_post.subtract(vh_pre).rename('VH_diff');

  // 线性功率比值：先把 dB 转成线性功率 (10^(dB/10)) 再相除。
  // 直接对 dB 值相除没有物理意义，因此这里做了尺度转换。
  var vv_pre_lin = vv_pre.expression('Math.pow(10, b(0) / 10)');
  var vh_pre_lin = vh_pre.expression('Math.pow(10, b(0) / 10)');

  var vv_ratio = vv_post.expression('Math.pow(10, b(0) / 10)')
    .divide(vv_pre_lin)
    .clamp(0, 10)
    .rename('VV_ratio');

  // 若实验需要“极化组合特征”，可启用下面两行并加入特征栈：
  // var pol_pre  = vv_pre_lin.divide(vh_pre_lin).rename('Pol_pre');
  // var pol_post = vv_post.expression('Math.pow(10, b(0) / 10)')
  //                  .divide(vh_post.expression('Math.pow(10, b(0) / 10)'))
  //                  .rename('Pol_post');

  // ----------------------------------------------------------
  // 3.4 SAR 洪水候选
  // ----------------------------------------------------------
  var sarFlood = vv_diff.lt(vvThreshold)
    .and(vh_diff.lt(vhThreshold))
    .rename('SAR_Flood');

  var sarFlood01 = sarFlood.unmask(0).and(s1Valid);

  Map.addLayer(sarFlood.selfMask(), {palette: ['red']},
    'SAR Flood Candidate');

  // ----------------------------------------------------------
  // 3.5 Sentinel-2 云掩膜与合成
  // ----------------------------------------------------------
  function maskS2(image) {
    var qa = image.select('QA60');
    var clear = qa.bitwiseAnd(1 << 10).eq(0)
      .and(qa.bitwiseAnd(1 << 11).eq(0));
    return image.updateMask(clear);
  }

  var s2Collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate(postStart, postEnd)
    .map(maskS2);

  print('S2 collection:', s2Collection);
  print('S2 size:', s2Collection.size());
  print('S2 dates:', s2Collection.aggregate_array('system:time_start')
    .map(function (t) { return ee.Date(t).format('YYYY-MM-dd'); }));

  var s2 = s2Collection.median().clip(roi);

  // 3.6 S2 有效区域：B3 有值 = 1，无值 = 0
  var s2Valid = s2.select('B3').mask().unmask(0).gt(0).rename('S2_Valid');

  Map.addLayer(s2Valid.selfMask(), {palette: ['yellow']}, 'S2 Valid Area');

  // 3.7 NDVI / MNDWI
  var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var mndwi = s2.normalizedDifference(['B3', 'B11']).rename('MNDWI');

  print('MNDWI histogram:', ui.Chart.image.histogram({
    image: mndwi,
    region: roi,
    scale: 30,
    maxBuckets: 100,
    maxPixels: 1e10
  }));

  // 3.8 光学水体 / 非水体证据
  var opticalFlood = mndwi.gt(MNDWI_THRESHOLD).unmask(0).and(s2Valid)
    .rename('Optical_Flood');
  var opticalNonWater = mndwi.lt(0).unmask(0).and(s2Valid)
    .rename('Optical_NonWater');

  // ----------------------------------------------------------
  // 3.9 DEM / 坡度 / JRC 永久水体
  // ----------------------------------------------------------
  var dem = ee.Image('USGS/SRTMGL1_003').clip(roi).rename('DEM');
  var slope = ee.Terrain.slope(dem).rename('slope');
  var lowSlope01 = slope.lt(SLOPE_LIMIT).unmask(0);

  var jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
    .select('occurrence')
    .rename('JRC_occurrence');
  var permanentWater = jrc.gt(90).unmask(0);
  var nonPermanentWater = permanentWater.eq(0);

  Map.addLayer(permanentWater.selfMask(), {palette: ['cyan']},
    'JRC Permanent Water');

  // ----------------------------------------------------------
  // 3.10 伪标签：High / Medium Flood
  // ----------------------------------------------------------
  // High Flood：SAR 下降 + S2 确认水体 + 非永久水 + 低坡度
  var highConfidenceFlood = sarFlood01
    .and(opticalFlood)
    .and(nonPermanentWater)
    .and(lowSlope01)
    .rename('HighConfidenceFlood');

  // Medium Flood：SAR 下降 + 无 S2 + 非永久水 + 低坡度（缺少光学确认）
  var mediumConfidenceFlood = sarFlood01
    .and(s2Valid.not())
    .and(nonPermanentWater)
    .and(lowSlope01)
    .rename('MediumConfidenceFlood');

  var highFlood01 = highConfidenceFlood.unmask(0);
  var mediumFlood01 = mediumConfidenceFlood.unmask(0);

  // ----------------------------------------------------------
  // 3.11 SAR 稳定区
  // ----------------------------------------------------------
  var vvMedian = ee.Number(
    vv_diff.updateMask(s1Valid).reduceRegion({
      reducer: ee.Reducer.median(),
      geometry: roi,
      scale: 30,
      bestEffort: true,
      maxPixels: 1e10
    }).get('VV_diff')
  );
  var vhMedian = ee.Number(
    vh_diff.updateMask(s1Valid).reduceRegion({
      reducer: ee.Reducer.median(),
      geometry: roi,
      scale: 30,
      bestEffort: true,
      maxPixels: 1e10
    }).get('VH_diff')
  );

  print('VV_diff median (reference):', vvMedian);
  print('VH_diff median (reference):', vhMedian);

  var vvStable = (USE_ABSOLUTE_STABLE === true)
    ? vv_diff.abs().lt(ABS_STABLE_TOLERANCE)
    : vv_diff.subtract(vvMedian).abs().lt(STABLE_TOLERANCE);
  var vhStable = (USE_ABSOLUTE_STABLE === true)
    ? vh_diff.abs().lt(ABS_STABLE_TOLERANCE)
    : vh_diff.subtract(vhMedian).abs().lt(STABLE_TOLERANCE);

  var sarStable01 = vvStable.unmask(0).and(vhStable.unmask(0))
    .and(s1Valid)
    .rename('SAR_Stable');

  Map.addLayer(sarStable01.selfMask(), {palette: ['red']}, 'SAR Stable');

  // ----------------------------------------------------------
  // 3.12 伪标签：High / Medium Non-Flood
  // ----------------------------------------------------------
  // High Non-Flood：SAR 稳定 + S2 确认非水体 + 非永久水 + 与洪水类互斥
  var highConfidenceNonFlood = sarStable01
    .and(s2Valid)
    .and(opticalNonWater)
    .and(nonPermanentWater)
    .and(sarFlood01.not())
    .and(highFlood01.not())
    .and(mediumFlood01.not())
    .rename('HighConfidenceNonFlood');

  // Medium Non-Flood：无 S2 时的 SAR 稳定区，与 Flood 的证据等级对称
  var mediumConfidenceNonFlood = sarStable01
    .and(s2Valid.not())
    .and(nonPermanentWater)
    .and(sarFlood01.not())
    .and(highFlood01.not())
    .and(mediumFlood01.not())
    .rename('MediumConfidenceNonFlood');

  if (NONFLOOD_REQUIRE_LOWSLOPE === true) {
    highConfidenceNonFlood = highConfidenceNonFlood.and(lowSlope01);
    mediumConfidenceNonFlood = mediumConfidenceNonFlood.and(lowSlope01);
  }

  // 冲突保护：万一某像元同时进入正负类，优先保留洪水证据
  var anyFlood01 = highFlood01.or(mediumFlood01);
  var highNonFlood01 = highConfidenceNonFlood.unmask(0).and(anyFlood01.not());
  var mediumNonFlood01 = mediumConfidenceNonFlood.unmask(0)
    .and(anyFlood01.not()).and(highNonFlood01.not());

  // ----------------------------------------------------------
  // 3.13 最终 label 与置信度来源
  // ----------------------------------------------------------
  // 是否把中置信类别纳入 label（可配置，便于做敏感性实验）
  var floodUsed = USE_MEDIUM_AS_FLOOD === true
    ? anyFlood01
    : highFlood01;
  var nonFloodUsed = USE_MEDIUM_NONFLOOD === true
    ? highNonFlood01.or(mediumNonFlood01)
    : highNonFlood01;

  nonFloodUsed = nonFloodUsed.and(floodUsed.not());

  var knownArea = floodUsed.or(nonFloodUsed);
  var label = ee.Image(0)
    .where(floodUsed, 1)
    .updateMask(knownArea)
    .rename('label');

  var unknown = knownArea.not().rename('Unknown');

  // 置信度来源记录（导出为样本属性，便于分层和论文说明）：
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

  print('High Confidence Flood count:', highConfidenceFlood.selfMask()
    .reduceRegion({reducer: ee.Reducer.count(), geometry: roi, scale: 30,
      bestEffort: true, maxPixels: 1e10}));
  print('Medium Confidence Flood count:', mediumConfidenceFlood.selfMask()
    .reduceRegion({reducer: ee.Reducer.count(), geometry: roi, scale: 30,
      bestEffort: true, maxPixels: 1e10}));
  print('High Confidence Non-Flood count:', highConfidenceNonFlood.selfMask()
    .reduceRegion({reducer: ee.Reducer.count(), geometry: roi, scale: 30,
      bestEffort: true, maxPixels: 1e10}));
  print('Medium Confidence Non-Flood count:', mediumConfidenceNonFlood.selfMask()
    .reduceRegion({reducer: ee.Reducer.count(), geometry: roi, scale: 30,
      bestEffort: true, maxPixels: 1e10}));

  // ----------------------------------------------------------
  // 3.14 机器学习特征栈
  // ----------------------------------------------------------
  // 关键修改：所有特征先 unmask(0)，保证 Medium（无 S2）样本不会被
  // stratifiedSample 的 dropNulls 丢弃；label 仍保留掩膜，Unknown 不抽样。
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

  var sampleImage = featureStack.addBands([label, confFlood, confNonFlood]);

  // ----------------------------------------------------------
  // 3.15 动态抽样
  // ----------------------------------------------------------
  function countOnes(maskImage) {
    return ee.Number(maskImage.selfMask().reduceRegion({
      reducer: ee.Reducer.count(),
      geometry: roi,
      scale: 30,
      bestEffort: true,
      maxPixels: 1e10
    }).values().get(0));
  }

  var nFlood = countOnes(label.eq(1));
  var nNonFlood = countOnes(label.eq(0));

  print('Label Flood pixel count:', nFlood);
  print('Label Non-Flood pixel count:', nNonFlood);

  // 在 Code Editor 中取客户端数值，决定实际抽样数（类不足则少抽，避免报错）
  var nFloodC = Math.min(MAX_POINTS_PER_CLASS, ee.Number(nFlood).getInfo());
  var nNonFloodC = Math.min(MAX_POINTS_PER_CLASS, ee.Number(nNonFlood).getInfo());

  var samples = ee.FeatureCollection([]);

  if (nFloodC > 0 && nNonFloodC > 0) {
    samples = sampleImage.stratifiedSample({
      numPoints: nFloodC + nNonFloodC,
      classBand: 'label',
      region: roi,
      scale: 30,
      classValues: [0, 1],
      classPoints: [nNonFloodC, nFloodC],
      geometries: true,
      seed: 42,
      tileScale: 4
    });
  } else {
    print('警告：Flood 或 Non-Flood 已知像元为 0，未执行抽样。');
  }

  // 加入 train/validation 划分列（0.7/0.3），便于实验一后续精度评价
  samples = samples.randomColumn('rand', 42).map(function (f) {
    var r = ee.Number(f.get('rand'));
    return f.set({
      split: ee.Algorithms.If(r.lt(0.7), 'train', 'val')
    });
  });

  print('Final training samples:', samples);
  print('Training sample number:', samples.size());
  print('Training label histogram:', samples.aggregate_histogram('label'));
  print('Training conf_flood histogram:',
    samples.aggregate_histogram('conf_flood'));
  print('Training conf_nonflood histogram:',
    samples.aggregate_histogram('conf_nonflood'));
  print('Training split histogram:', samples.aggregate_histogram('split'));

  // ----------------------------------------------------------
  // 3.16 可视化
  // ----------------------------------------------------------
  Map.addLayer(highConfidenceFlood.selfMask(), {palette: ['blue']},
    'High Confidence Flood');
  Map.addLayer(mediumConfidenceFlood.selfMask(), {palette: ['orange']},
    'Medium Confidence Flood');
  Map.addLayer(highConfidenceNonFlood.selfMask(), {palette: ['green']},
    'High Confidence Non-Flood');
  Map.addLayer(mediumConfidenceNonFlood.selfMask(), {palette: ['darkgreen']},
    'Medium Confidence Non-Flood');
  Map.addLayer(label, {min: 0, max: 1, palette: ['white', 'blue']},
    'Final Pseudo Label');

  Map.addLayer(s1_pre, {bands: ['VV'], min: -20, max: 0}, 'S1 Pre VV');
  Map.addLayer(s1_post, {bands: ['VV'], min: -20, max: 0}, 'S1 Post VV');
  Map.addLayer(mndwi, {min: -0.5, max: 0.8}, 'MNDWI');

  // ----------------------------------------------------------
  // 3.17 返回结果
  // ----------------------------------------------------------
  return {
    samples: samples,
    label: label,
    confFlood: confFlood,
    confNonFlood: confNonFlood,
    unknown: unknown,
    featureStack: featureStack,
    highConfidenceFlood: highConfidenceFlood,
    mediumConfidenceFlood: mediumConfidenceFlood,
    highConfidenceNonFlood: highConfidenceNonFlood,
    mediumConfidenceNonFlood: mediumConfidenceNonFlood,
    sarFlood: sarFlood,
    sarStable: sarStable01,
    mndwi: mndwi,
    s2Valid: s2Valid,
    s1Valid: s1Valid
  };
};

// ============================================================
// 4. 执行
// ============================================================
var result = FloodMap(roi);
var resFlood = result.samples;

// ============================================================
// 5. 导出训练样本（含特征 + label + conf + split）
// ============================================================
Export.table.toDrive({
  collection: resFlood,
  description: 'Wuhan_2016_Flood_PseudoLabel_RF_v2',
  fileFormat: 'CSV'
});

// ============================================================
// 6. 下一步：RF 训练与精度评价（实验一主体，可在同一脚本中补上）
// ------------------------------------------------------------
// 建议：
//   var train = resFlood.filter(ee.Filter.eq('split', 'train'));
//   var val   = resFlood.filter(ee.Filter.eq('split', 'val'));
//   var rf = ee.Classifier.smileRandomForest(100).train({
//     features: train, classProperty: 'label',
//     inputProperties: FEATURE_NAMES
//   });
//   var valPred = val.classify(rf, 'pred');
//   print('OA:', valPred.errorMatrix('label','pred').accuracy());
//   print('Confusion matrix:', valPred.errorMatrix('label','pred'));
//   var floodMap = result.featureStack.classify(rf).rename('flood');
//   Map.addLayer(floodMap.eq(1).selfMask(), {palette:['red']}, 'RF Flood Map');
// ============================================================
