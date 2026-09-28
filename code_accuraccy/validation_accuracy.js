// ============================================================================
// 第二阶段（B）：伪标签精度计算
//   对应文档《伪标签精度验证.md》第十八 ~ 第二十五节
// ----------------------------------------------------------------------------
// 输入（二选一）：
//   ① INPUT_MODE = 'inline'：把 code/validation_review.js 判读台
//      "打印已判 JSON" 的输出整段粘到下面的 REFERENCE_INLINE；
//   ② INPUT_MODE = 'asset' ：把判读导出的 CSV 传到 GEE Assets，
//      资产 ID 填到 REFERENCE_ASSET。
//
// 输出：
//   · Console 打印逐事件 + 合并的混淆矩阵与 OA / Precision / Recall / F1 / Kappa
//   · Tasks 导出 CSV：Wuhan_pseudo_label_accuracy（须在 Tasks 面板点 RUN 才执行）
//
// 口径（严格照文档）：
//   · 先剔除 reference = -1（Uncertain）的点，再建混淆矩阵
//   · 混淆矩阵：行 = 伪标签，列 = 人工 Reference
//       Pseudo Flood     & Reference Flood     -> TP
//       Pseudo Flood     & Reference Non-Flood -> FP
//       Pseudo Non-Flood & Reference Flood     -> FN
//       Pseudo Non-Flood & Reference Non-Flood -> TN
//   · OA        = (TP + TN) / (TP + TN + FP + FN)
//   · Precision = TP / (TP + FP)      Recall = TP / (TP + FN)
//   · F1        = 2 * Precision * Recall / (Precision + Recall)
//   · Pe        = [(TP+FP)(TP+FN) + (FN+TN)(FP+TN)] / N^2
//   · Kappa     = (OA - Pe) / (1 - Pe)
// ============================================================================

// ---- 输入 ----
var INPUT_MODE = 'inline';   // 'inline' | 'asset'
var REFERENCE_ASSET = 'projects/studied-glow-475306-v5/assets/validation_reference';
var REFERENCE_INLINE = [
  // ↓↓↓ 用判读台打印的 JSON 整段替换这里（下面只是一行示例，正式使用时删掉）
  // {point_id: 'Wuhan_2020_0705_12', event_id: 'Wuhan_2020_0705',
  //  pseudo_label: 1, reference: 1, confidence: 2}
];

// ---- 计算口径开关 ----
var DROP_ZERO_CONFIDENCE = false;  // true = 连同 confidence = 0（无法判断）的点一起剔除
var ROUND_DIGITS = 4;              // 指标保留小数位
var EXPORT_ACCURACY = true;        // 是否提交精度表 CSV 导出任务


// ============================================================================
// 1. 读入并归一化字段
//   判读结果里伪标签列正常叫 pseudo_label；万一拿到的是早期导出的样本表
//   （列名是 label），这里自动退回 label，避免"少列就整张表算空"。
// ============================================================================
if (INPUT_MODE === 'inline' && REFERENCE_INLINE.length === 0) {
  print('⚠ REFERENCE_INLINE 还是空的：先跑 code/validation_review.js 完成判读，'
    + '把"打印已判 JSON"的输出粘进来，或改用 INPUT_MODE = "asset"。');
}

var rawFc = (INPUT_MODE === 'asset')
  ? ee.FeatureCollection(REFERENCE_ASSET)
  : ee.FeatureCollection(REFERENCE_INLINE);

var pointsFc = rawFc.map(function (f) {
  var hasPseudo = f.propertyNames().contains('pseudo_label');
  return ee.Feature(null, {
    point_id: f.get('point_id'),
    event_id: f.get('event_id'),
    pseudo_label: ee.Number(ee.Algorithms.If(hasPseudo, f.get('pseudo_label'), f.get('label'))),
    reference: ee.Number(f.get('reference')),
    confidence: ee.Number(f.get('confidence'))
  });
});


// ============================================================================
// 2. 数据体检：先剔除 Uncertain，再报三类异常（都为 0 才说明表是干净的）
// ============================================================================
var evalFc = pointsFc.filter(ee.Filter.neq('reference', -1));
if (DROP_ZERO_CONFIDENCE) {
  evalFc = evalFc.filter(ee.Filter.neq('confidence', 0));
}

print('点表总数:', pointsFc.size());
print('剔除 reference = -1 后参与评价:', evalFc.size());
print('reference 分布（-1 Uncertain / 0 Non-Flood / 1 Flood）:',
  pointsFc.aggregate_histogram('reference'));
print('confidence 分布（0 无法判断 / 1 一般可信 / 2 高可信）:',
  pointsFc.aggregate_histogram('confidence'));
print('应为 0 → reference 取值异常点数:',
  pointsFc.filter(ee.Filter.neq('reference', -1)
    .and(ee.Filter.neq('reference', 0))
    .and(ee.Filter.neq('reference', 1))).size());
print('应为 0 → pseudo_label 取值异常点数（非 0/1）:',
  pointsFc.filter(ee.Filter.neq('pseudo_label', 0)
    .and(ee.Filter.neq('pseudo_label', 1))).size());


// ============================================================================
// 3. 混淆矩阵与指标
// ============================================================================
function round4(x) {
  var k = Math.pow(10, ROUND_DIGITS);
  return ee.Number(x).multiply(k).round().divide(k);
}

function metricsOf(sub) {
  var tp = ee.Number(sub.filter(ee.Filter.eq('pseudo_label', 1)
    .and(ee.Filter.eq('reference', 1))).size());
  var fp = ee.Number(sub.filter(ee.Filter.eq('pseudo_label', 1)
    .and(ee.Filter.eq('reference', 0))).size());
  var fn = ee.Number(sub.filter(ee.Filter.eq('pseudo_label', 0)
    .and(ee.Filter.eq('reference', 1))).size());
  var tn = ee.Number(sub.filter(ee.Filter.eq('pseudo_label', 0)
    .and(ee.Filter.eq('reference', 0))).size());

  var n = tp.add(tn).add(fp).add(fn);
  var oa = tp.add(tn).divide(n);
  var precision = tp.divide(tp.add(fp));
  var recall = tp.divide(tp.add(fn));
  var f1 = precision.multiply(recall).multiply(2).divide(precision.add(recall));
  // 文档第二十三节的 Pe
  var pe = tp.add(fp).multiply(tp.add(fn))
    .add(fn.add(tn).multiply(fp.add(tn)))
    .divide(n.multiply(n));
  var kappa = oa.subtract(pe).divide(ee.Number(1).subtract(pe));

  return ee.Dictionary({
    N: n,
    TP: tp, FP: fp, FN: fn, TN: tn,
    OA: round4(oa),
    Precision: round4(precision),
    Recall: round4(recall),
    F1: round4(f1),
    Kappa: round4(kappa),
    Pe: round4(pe)
  });
}


// ============================================================================
// 4. 逐事件 + 合并
// ============================================================================
var eventIds = ee.List(pointsFc.aggregate_array('event_id')).distinct();

var perEvent = ee.FeatureCollection(eventIds.map(function (eid) {
  var sub = evalFc.filter(ee.Filter.eq('event_id', eid));
  return ee.Feature(null, metricsOf(sub).combine(ee.Dictionary({event_id: eid})));
}));

var overall = ee.Feature(null,
  metricsOf(evalFc).combine(ee.Dictionary({event_id: 'ALL 合并'})));

var report = perEvent.merge(ee.FeatureCollection([overall]));

print('混淆矩阵（行 = 伪标签，列 = 人工 Reference）:', report.map(function (f) {
  return ee.Feature(null, {
    event_id: f.get('event_id'),
    'TP 伪Flood×真Flood': f.get('TP'),
    'FP 伪Flood×真NonFlood': f.get('FP'),
    'FN 伪NonFlood×真Flood': f.get('FN'),
    'TN 伪NonFlood×真NonFlood': f.get('TN')
  });
}));

print('精度表（文档第二十四节格式，逐事件 + 合并）:', report);
print('指标含义：OA 总体精度；Precision 伪 Flood 纯度；Recall 真 Flood 召回；'
  + 'F1 兼顾二者的调和平均；Kappa 相对随机一致性的提高（Pe 为随机一致概率）。');
print('文档第二十五节：重点看三个事件之间 OA / F1 是否相对稳定，而不是单看某一事件。');


// ============================================================================
// 5. 导出（Tasks 面板点 RUN 才真正执行）
// ============================================================================
if (EXPORT_ACCURACY) {
  Export.table.toDrive({
    collection: report,
    description: 'Wuhan_pseudo_label_accuracy',
    fileFormat: 'CSV',
    selectors: ['event_id', 'N', 'TP', 'FP', 'FN', 'TN',
      'OA', 'Precision', 'Recall', 'F1', 'Kappa']
  });
  print('已提交精度表导出：Wuhan_pseudo_label_accuracy.csv（到 Tasks 面板点 RUN）。');
}
