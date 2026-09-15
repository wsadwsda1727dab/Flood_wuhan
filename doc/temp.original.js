// 1. 研究区

var wuhan = ee.FeatureCollection("projects/studied-glow-475306-v5/assets/wuhan");

var roi = wuhan;

Map.centerObject(roi,9);

Map.addLayer(roi,{color:'black'},'Wuhan');



// 2. 洪涝事件时间
// 【修改】当前采用你已经测试过的武汉2016年时间窗口
var preStart = '2016-05-20';
var preEnd   = '2016-06-10';

var postStart = '2016-07-05';
var postEnd   = '2016-07-25';


// ============================================================
// 3. FloodMap主函数
// ============================================================


// 辅助诊断（建议加）
print('S1 pre orbits:', ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(roi).filterDate(preStart,preEnd)
  .aggregate_histogram('relativeOrbitNumber'));
print('S1 post orbits:', ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(roi).filterDate(postStart,postEnd)
  .aggregate_histogram('relativeOrbitNumber'));
  
var FloodMap = function(roi){

  // 3.1 Sentinel-1 SAR数据

  function getS1(start,end){

    return ee.ImageCollection('COPERNICUS/S1_GRD')
      .filterBounds(roi)
      .filterDate(start,end)
      .filter(ee.Filter.eq('instrumentMode','IW'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VV'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VH'))
      .select(['VV','VH'])
      .median()
      .clip(roi);

  }


  var s1_pre = getS1(preStart,preEnd);

  var s1_post = getS1(postStart,postEnd);


  print('S1 pre:',s1_pre);

  print('S1 post:',s1_post);

  // 3.2 VV / VH

  var vv_pre = s1_pre.select('VV');
  var vv_post = s1_post.select('VV');
  var vh_pre = s1_pre.select('VH');
  var vh_post = s1_post.select('VH');


 
  // 3.3 SAR变化特征


  var vv_diff = vv_post.subtract(vv_pre).rename('VV_diff');

  var vh_diff = vh_post.subtract(vh_pre).rename('VH_diff');
  
  

  var vv_histogram = vv_diff.reduceRegion({
    reducer: ee.Reducer.histogram(255), // 255个分箱，最小宽度2
    geometry: roi,
    scale: 30, 
    bestEffort: true
  });
  
  var hist = ui.Chart.image.histogram({
    image:vv_diff,
    region:roi,
    scale:30,
    maxBuckets:100,
    maxPixels:1e10
  });

  print('vv_diff直方图:',hist);
  
  
  var myLib = require('users/PRO_STU1/Pro1:mode');
  
  var threshold = myLib.getOtsuThreshold(vv_histogram.get("VV_diff"));
  print(' Otsu 阈值:', threshold);

  
  // dB 先转线性功率，再相除；直接对 dB 值相除没有物理意义
  var vv_pre_lin = vv_pre.expression('pow(10, b(0) / 10)');
  var vv_ratio = vv_post.expression('pow(10, b(0) / 10)')
    .divide(vv_pre_lin)
    .rename('VV_ratio');


  // 3.4 【修改】SAR洪水变化阈值
  // 这里采用更加保守的初始阈值：
  // VV下降超过4 dB
  // VH下降超过3.5 dB
  var oeel = require('users/OEEL/lib:loadAll');
  // 对影像集合计算Otsu阈值
  var vvthreshold = oeel.ImageCollection.OtsuThreshold(ee.ImageCollection(vv_diff), 'VV_diff');
  print("vvOtsu:",vvthreshold);

  var vvThreshold = -4.0;

  var vhThreshold = -3.5;

  // 3.5 SAR洪水候选

  var sarFlood = vv_diff
    .lt(vvThreshold)
    .and(vh_diff.lt(vhThreshold))
    .rename('SAR_Flood');


  Map.addLayer(
    sarFlood.selfMask(),
    {palette:['red']},
    'SAR Flood Candidate'
  );



  // 3.6 Sentinel-2云掩膜


  function maskS2(image){

    var qa = image.select('QA60');

    var cloud = qa.bitwiseAnd(1 << 10).eq(0)
      .and(qa.bitwiseAnd(1 << 11).eq(0));

    return image.updateMask(cloud);

  }



  // 3.7 Sentinel-2
 

  var s2Collection = ee.ImageCollection(
    'COPERNICUS/S2_SR_HARMONIZED'
  )
  .filterBounds(roi)
  .filterDate(postStart,postEnd)
  .map(maskS2);


  print('S2 collection:',s2Collection);

  print('S2 size:',s2Collection.size());

  



  // 3.8 【修改】获取S2影像
 
  var s2 = s2Collection
    .median()
    .clip(roi);



  // 3.9 S2有效区域
 
 
  // 用B3是否有有效值判断该位置是否存在可用S2。
  //
  // S2没有覆盖的区域：
  // s2Valid = 0
  //
  // 有有效S2：
  // s2Valid = 1

  var s2Valid = s2.select('B3').mask().unmask(0).gt(0).rename('S2_Valid');

  Map.addLayer(
    s2Valid.selfMask(),
    {palette:['yellow']},
    'S2 Valid Area'
  );


  // 3.10 NDVI
  var ndvi = s2
    .normalizedDifference(['B8','B4'])
    .rename('NDVI');


  // 3.11 MNDWI
  var mndwi = s2
    .normalizedDifference(['B3','B11'])
    .rename('MNDWI');

 
  // 3.12 MNDWI直方图
  var hist = ui.Chart.image.histogram({
    image:mndwi,
    region:roi,
    scale:30,
    maxBuckets:100,
    maxPixels:1e10
  });

  print('MNDWI直方图:',hist);



  // 3.13 【修改】光学洪水证据
  // MNDWI > 0.2
  // 只有S2有效区域才允许使用这个条件。

  var opticalFlood = mndwi
    .gt(0.2)
    .and(s2Valid)
    .rename('Optical_Flood');


  // 3.14 光学非水体
  var opticalNonWater = mndwi.lt(0).unmask(0).and(s2Valid).rename('Optical_NonWater');
  var nonFloodOpticalCondition = opticalNonWater.or(s2Valid.not());

 
  // 3.15 DEM
  var dem = ee.Image('USGS/SRTMGL1_003')
    .clip(roi)
    .rename('DEM');


  
  // 3.16 坡度
  

  var slope = ee.Terrain
    .slope(dem)
    .rename('slope');


  // 3.17 低坡度区域
  var lowSlope = slope
    .lt(5)
    .rename('LowSlope');



  // 3.18 JRC永久水体
  var jrc = ee.Image(
    'JRC/GSW1_4/GlobalSurfaceWater'
  )
  .select('occurrence');


  // 3.19 永久水体
  var permanentWater = jrc
    .gt(90)
    .rename('PermanentWater');


  
  // 3.20 【修改】处理JRC空白
  
  // JRC本身存在mask。
  //
  // 如果直接：
  //
  // permanentWater.not()
  //
  // JRC没有数据的地方仍然是空白。
  //
  // 因此这里先unmask(0)。
 

  var nonPermanentWater = permanentWater
    .unmask(0)
    .eq(0)
    .rename('NonPermanentWater');


  Map.addLayer(
    permanentWater.selfMask(),
    {palette:['cyan']},
    'JRC Permanent Water'
  );


  // ==========================================================
  // 3.21 【修改】High Confidence Flood
  // ==========================================================
  //
  // 高置信洪水必须同时满足：
  //
  // 1. SAR明显下降
  // 2. S2有效
  // 3. MNDWI确认水体
  // 4. 不是永久水体
  // 5. 坡度较低
  //
  // 这是最可靠的Flood伪标签。
  // ==========================================================

  var highConfidenceFlood = sarFlood
    .and(opticalFlood)
    .and(nonPermanentWater)
    .and(lowSlope)
    .rename('HighConfidenceFlood');


  
  // 3.22 【修改】Medium Confidence Flood

  //
  // 对于没有S2覆盖的区域：
  //
  // SAR明显下降
  // +
  // 非永久水体
  // +
  // 低坡度
  //
  // 但是没有MNDWI确认。
  //
  // 因此只能作为Medium Confidence Flood，
  // 后续人工检查。
  var mediumConfidenceFlood = sarFlood
    .and(s2Valid.not())
    .and(nonPermanentWater)
    .and(lowSlope)
    .rename('MediumConfidenceFlood');
    
  var highFlood01 = highConfidenceFlood.unmask(0);
  var mediumFlood01 = mediumConfidenceFlood.unmask(0);

  // 3.23 【修改】SAR稳定区域

  // 这里根据事件前后SAR变化的中位数，
  // 寻找相对于整体变化中心比较接近的区域。


  var vvMedian = ee.Number(
    vv_diff.reduceRegion({
      reducer:ee.Reducer.median(),
      geometry:roi,
      scale:30,
      bestEffort:true,
      maxPixels:1e10
    }).get('VV_diff')
  );


  var vhMedian = ee.Number(
    vh_diff.reduceRegion({
      reducer:ee.Reducer.median(),
      geometry:roi,
      scale:30,
      bestEffort:true,
      maxPixels:1e10
    }).get('VH_diff')
  );


  print('VV_diff median:',vvMedian);

  print('VH_diff median:',vhMedian);


  // 3.24 【修改】稳定阈值
  //


  var stableTolerance = 1.5;


  var vvStable = vv_diff
    .subtract(vvMedian)
    .abs()
    .lt(stableTolerance);


  var vhStable = vh_diff
    .subtract(vhMedian)
    .abs()
    .lt(stableTolerance);


  var sarStable = vvStable
    .and(vhStable)
    .rename('SAR_Stable');


  Map.addLayer(
    sarStable.selfMask(),
    {palette:['red']},
    'SAR Stable'
  );


  // ==========================================================
  // 3.25 High Confidence Non-Flood
  // ==========================================================
  //
  // 高置信Non-Flood：
  //
  // SAR变化稳定
  // +
  // 不是永久水体
  // +
  // 如果存在S2，则MNDWI应该显示非水体
  //
  // 注意：
  // S2没有数据的区域不会因为unmask直接全部变成Non-Flood。
 
    
  // High Non-Flood：必须有 S2，且 MNDWI 确认非水体
  var highConfidenceNonFlood = sarStable
    .and(s2Valid)
    .and(opticalNonWater)
    .and(nonPermanentWater)
    .and(sarFlood.unmask(0).not())
    .and(highFlood01.not())
    .and(mediumFlood01.not())
    .and(lowSlope)          // 让正负样本条件对称；不加也可以
    .rename('HighConfidenceNonFlood');
  
  // Medium Non-Flood：无 S2 区域的 SAR 稳定区，与 Medium Flood 证据等级对称
  var mediumConfidenceNonFlood = sarStable
    .and(s2Valid.not())
    .and(nonPermanentWater)
    .and(sarFlood.unmask(0).not())
    .and(highFlood01.not())
    .and(mediumFlood01.not())
    .and(lowSlope)          // 同上，可选
    .rename('MediumConfidenceNonFlood');


  // ==========================================================
  // 3.27 Unknown区域
  // ==========================================================
  //
  // 没有足够证据判断的区域：
  //
  // 不作为训练样本。
  // ==========================================================
  var floodArea = highConfidenceFlood.unmask(0).or(mediumConfidenceFlood.unmask(0));

  var nonFloodArea = highConfidenceNonFlood.unmask(0)
    .or(mediumConfidenceNonFlood.unmask(0))
    .and(floodArea.not());   // 冲突时洪水优先
  
  var knownArea = floodArea.or(nonFloodArea);

  var unknown = knownArea
    .not()
    .rename('Unknown');


  // 3.28 最终Flood伪标签
  // High Flood = 1
  // Medium Flood = 1
  // High Non-Flood = 0
  // Unknown = mask
  // Unknown不进入RF训练。
 
  var label = ee.Image(0)
    .where(floodArea,1)
    .updateMask(knownArea)
    .rename('label');
    
  // var label = ee.Image(0)
  //   .where(
  //     highConfidenceFlood,
  //     1
  //   )
  //   .where(
  //     mediumConfidenceFlood,
  //     1
  //   )
  //   .updateMask(
  //     knownArea
  //   )
  //   .rename('label');


  // ==========================================================
  // 3.29 显示High Confidence Flood
  // ==========================================================

  Map.addLayer(
    highConfidenceFlood.selfMask(),
    {palette:['blue']},
    'High Confidence Flood'
  );


  // ==========================================================
  // 3.30 显示Medium Confidence Flood
  // ==========================================================

  Map.addLayer(
    mediumConfidenceFlood.selfMask(),
    {palette:['orange']},
    'Medium Confidence Flood'
  );


  // ==========================================================
  // 3.31 显示High Confidence Non-Flood
  // ==========================================================

  Map.addLayer(
    highConfidenceNonFlood.selfMask(),
    {palette:['green']},
    'High Confidence Non-Flood'
  );


  // ==========================================================
  // 3.32 显示最终Label
  // ==========================================================

  Map.addLayer(
    label,
    {
      min:0,
      max:1,
      palette:['white','blue']
    },
    'Final Pseudo Label'
  );


  // ==========================================================
  // 3.33 【修改】统计三类伪标签面积/像元数量
  // ==========================================================

  print(
    'High Confidence Flood count:',
    highConfidenceFlood.selfMask().reduceRegion({
      reducer:ee.Reducer.count(),
      geometry:roi,
      scale:30,
      bestEffort:true,
      maxPixels:1e10
    })
  );


  print(
    'Medium Confidence Flood count:',
    mediumConfidenceFlood.selfMask().reduceRegion({
      reducer:ee.Reducer.count(),
      geometry:roi,
      scale:30,
      bestEffort:true,
      maxPixels:1e10
    })
  );


  print(
    'High Confidence Non-Flood count:',
    highConfidenceNonFlood.selfMask().reduceRegion({
      reducer:ee.Reducer.count(),
      geometry:roi,
      scale:30,
      bestEffort:true,
      maxPixels:1e10
    })
  );


 
  // 3.34 构建机器学习特征
  var stack = vv_post.unmask(0).rename('VV')
    .addBands(vh_post.unmask(0).rename('VH'))
    .addBands(vv_diff.unmask(0))
    .addBands(vh_diff.unmask(0))
    .addBands(vv_ratio.unmask(0))
    .addBands(ndvi.unmask(0))
    .addBands(mndwi.unmask(0))
    .addBands(dem.unmask(0))
    .addBands(slope.unmask(0))
    .addBands(s2Valid.toFloat().rename('S2_Valid'))
    .addBands(highConfidenceFlood.unmask(0).multiply(2)
      .add(mediumConfidenceFlood.unmask(0)).rename('conf_flood'))
    .addBands(highConfidenceNonFlood.unmask(0).multiply(2)
      .add(mediumConfidenceNonFlood.unmask(0)).rename('conf_nonflood'))
    .addBands(label);


  // ==========================================================
  // 3.35 【修改】生成训练样本
  // ==========================================================
  //
  // 只从High Confidence Flood、
  // Medium Confidence Flood、
  // High Confidence Non-Flood
  // 中抽样。
  //
  // Unknown已经被mask，不会进入样本。
  // ==========================================================

  var samples = stack.stratifiedSample({
    numPoints:4000,
    classBand:'label',
    region:roi,
    scale:30,
    classValues:[0,1],
    classPoints:[2000,2000],
    geometries:true,
    seed:42,
    tileScale:4
  });


  print('Final training samples:',samples);

  print('Training sample number:',samples.size());
  
  Map.addLayer(samples,{},"samples");


  // ==========================================================
  // 3.36 训练样本类别统计
  // ==========================================================

  print(
    'Training label histogram:',
    samples.aggregate_histogram('label')
  );


  // ==========================================================
  // 3.37 显示SAR前后影像
  // ==========================================================

  Map.addLayer(
    s1_pre,
    {
      bands:['VV'],
      min:-20,
      max:0
    },
    'S1 Pre VV'
  );


  Map.addLayer(
    s1_post,
    {
      bands:['VV'],
      min:-20,
      max:0
    },
    'S1 Post VV'
  );


  // ==========================================================
  // 3.38 显示MNDWI
  // ==========================================================

  Map.addLayer(
    mndwi,
    {
      min:-0.5,
      max:0.8
    },
    'MNDWI'
  );


  // ==========================================================
  // 3.39 返回结果
  // ==========================================================

  return {
    samples:samples,
    label:label,
    highConfidenceFlood:highConfidenceFlood,
    mediumConfidenceFlood:mediumConfidenceFlood,
    highConfidenceNonFlood:highConfidenceNonFlood,
    sarFlood:sarFlood,
    sarStable:sarStable,
    mndwi:mndwi,
    s2Valid:s2Valid
  };

};


// ============================================================
// 4. 执行
// ============================================================

var result = FloodMap(roi);

// 5. 获取训练样本
var resFlood = result.samples;



// 6. 导出训练样本
Export.table.toDrive({
  collection:resFlood,
  description:'Wuhan_2016_Flood_PseudoLabel_RF',
  fileFormat:'CSV'
});