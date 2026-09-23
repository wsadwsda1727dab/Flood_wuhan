# Sentinel-1 与 Sentinel-2 后时相窗口分离修改建议

## 一、修改原因

当前代码使用：

```javascript
var POST_PAD_DAYS = 18;
```

该参数同时控制 Sentinel-1（S1）和 Sentinel-2（S2）的事件后数据窗口。

如果直接将：

```javascript
var POST_PAD_DAYS = 18;
```

修改为：

```javascript
var POST_PAD_DAYS = 5;
```

虽然可以使 Sentinel-2 更接近洪涝发生后的时间，但也会导致 Sentinel-1 的后时相搜索窗口从 18 天缩短至 5 天。

由于 Sentinel-1 存在重访周期限制，部分洪涝事件在 5 天内可能没有足够的有效影像，从而导致：

* S1 后时相影像数量不足；
* 前后时相无法形成稳定的变化检测；
* 部分事件可能被跳过；
* 研究区覆盖率下降；
* 伪标签数量减少。

因此，**不能简单地把 `POST_PAD_DAYS` 从 18 改成 5。**

---

# 二、正确的修改思路

应该将 Sentinel-1 和 Sentinel-2 的后时相窗口分开。

## Sentinel-1

保持较长的搜索窗口：

```text
事件结束
    ↓
最多向后18天搜索
```

目的：

> 保证能够找到足够的 Sentinel-1 后时相影像。

---

## Sentinel-2

缩短后时相窗口：

```text
事件结束
    ↓
向后5天
```

目的：

> 尽可能使 MNDWI 接近洪涝发生后的实际状态，减少洪水已经退去导致的光学水体漏检。

因此最终形成：

```text
                    洪涝事件
                       │
             ┌─────────┴─────────┐
             ↓                   ↓
        Sentinel-1           Sentinel-2
             │                   │
          +18天                 +5天
             │                   │
      保证S1影像数量        接近洪峰/积水状态
```

---

# 三、第一处修改：全局参数

原代码：

```javascript
var PRE_WINDOW_DAYS = 24;
var PRE_GAP_DAYS = 5;
var POST_PAD_DAYS = 18;
```

修改为：

```javascript
var PRE_WINDOW_DAYS = 24;
var PRE_GAP_DAYS = 5;

// Sentinel-1：保持较长窗口，保证能够找到足够的重访影像
var S1_POST_PAD_DAYS = 18;

// Sentinel-2：只取事件结束后最早5天，减少退水对MNDWI标签的影响
var S2_POST_PAD_DAYS = 5;
```

---

# 四、第二处修改：`eventWindows()` 函数

当前代码使用一个统一的 `postEndJs`：

```javascript
var postEndJs = ev.postEnd ? bjToUTC(ev.postEnd)
  : addDays(endUTC, POST_PAD_DAYS);
```

建议修改为分别计算 S1 和 S2 的结束时间：

```javascript
var s1PostEndJs = ev.postEnd ? bjToUTC(ev.postEnd)
  : addDays(endUTC, S1_POST_PAD_DAYS);

var s2PostEndJs = ev.s2PostEnd ? bjToUTC(ev.s2PostEnd)
  : addDays(endUTC, S2_POST_PAD_DAYS);
```

然后返回值修改为：

```javascript
return {
  preStart: ee.Date(preStartJs),
  preEnd: ee.Date(preEndJs),

  // Sentinel-1 后时相窗口
  s1PostStart: ee.Date(endUTC),
  s1PostEnd: ee.Date(s1PostEndJs),

  // Sentinel-2 后时相窗口
  s2PostStart: ee.Date(endUTC),
  s2PostEnd: ee.Date(s2PostEndJs),

  preStartStr: isoDate(preStartJs),
  preEndStr: isoDate(preEndJs),

  s1PostStartStr: isoDate(endUTC),
  s1PostEndStr: isoDate(s1PostEndJs),

  s2PostStartStr: isoDate(endUTC),
  s2PostEndStr: isoDate(s2PostEndJs),

  preDays: Math.round(
    (preEndJs - preStartJs) / 86400000
  ),

  s1PostDays: Math.round(
    (s1PostEndJs - endUTC) / 86400000
  ),

  s2PostDays: Math.round(
    (s2PostEndJs - endUTC) / 86400000
  )
};
```

---

# 五、第三处修改：Sentinel-1 数据获取

原代码：

```javascript
var s1postCol = getS1Collection(w.postStart, w.postEnd);
```

修改为：

```javascript
var s1postCol = getS1Collection(
  w.s1PostStart,
  w.s1PostEnd
);
```

这样 Sentinel-1 仍然使用：

```text
事件结束 → 事件结束 + 18天
```

不会因为缩短 S2 窗口而损失 S1 数据。

---

# 六、第四处修改：Sentinel-2 数据获取

原代码：

```javascript
function getS2Collection(id) {
  return ee.ImageCollection(id)
    .filterBounds(roi)
    .filterDate(w.postStart, w.postEnd)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', S2_MAX_CLOUD))
    .map(maskS2);
}
```

修改为：

```javascript
function getS2Collection(id) {
  return ee.ImageCollection(id)
    .filterBounds(roi)
    .filterDate(w.s2PostStart, w.s2PostEnd)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', S2_MAX_CLOUD))
    .map(maskS2);
}
```

这样 Sentinel-2 只搜索：

```text
事件结束 → 事件结束 + 5天
```

---

# 七、第五处：Sentinel-1 的 `post8` 不需要修改

当前代码中还有：

```javascript
var t0 = ee.Date(
  s1postCol.aggregate_min('system:time_start')
);

var post8 = s1postCol
  .filterDate(t0, t0.advance(8, 'day'))
  .map(dropFill);
```

这一部分**暂时不要修改**。

因为当前逻辑实际上是：

```text
S1搜索窗口
事件结束
    ↓
向后18天搜索
    ↓
寻找最早的S1影像
    ↓
以最早S1影像为起点
    ↓
取其后8天的S1影像
    ↓
形成S1后时相合成
```

因此：

> `18天` 是 Sentinel-1 的**搜索窗口**，而不是说最终一定使用18天后的洪水状态。

而 `post8` 才是当前实际参与 S1 后时相合成的主要时间范围。

---

# 八、最终时间窗口结构

修改完成后，整个流程应该是：

```text
                    洪涝事件
                       │
          ┌────────────┴────────────┐
          │                         │
          ↓                         ↓
    Sentinel-1                  Sentinel-2
          │                         │
    搜索后18天                  搜索后5天
          │                         │
          ↓                         ↓
   找到最早有效S1             获取早期S2影像
          │                         │
          ↓                         ↓
   最早S1后的8天              MNDWI计算
          │                         │
          ↓                         ↓
    VV/VH变化检测             光学水体证据
          │                         │
          └────────────┬────────────┘
                       ↓
                  洪涝伪标签
```

---

# 九、最终推荐参数

建议最终保留：

```javascript
// 事件前基线
var PRE_WINDOW_DAYS = 24;
var PRE_GAP_DAYS = 5;

// Sentinel-1 后时相搜索窗口
var S1_POST_PAD_DAYS = 18;

// Sentinel-2 后时相搜索窗口
var S2_POST_PAD_DAYS = 5;
```

即：

| 数据       |    后时相窗口 | 主要目的                 |
| ---------- | ------------: | ------------------------ |
| Sentinel-1 |          18天 | 保证有足够的重访影像     |
| Sentinel-2 |           5天 | 尽可能接近洪涝早期状态   |
| S1实际合成 | 最早S1之后8天 | 当前代码已有的S1合成逻辑 |

---

# 十、为什么这样修改更适合当前研究

当前伪标签存在的主要问题之一是：

> S2 后窗口过长可能导致 MNDWI 反映的是洪水消退后的状态。

这会使：

```text
SAR检测到洪水
        ↓
MNDWI没有检测到水
        ↓
High Flood被排除
        ↓
洪涝面积被低估
```

而如果简单把整个 `POST_PAD_DAYS` 从18天改成5天，又可能导致：

```text
S1后时相影像不足
        ↓
S1覆盖率下降
        ↓
部分事件无法进行可靠变化检测
```

因此最合理的方法不是在 **18天和5天之间二选一**，而是：

> **S1保持18天，S2单独缩短到5天。**

这样既保留 Sentinel-1 的时间覆盖能力，又减少 Sentinel-2 退水对伪标签的影响。

---

# 十一、修改完成后的下一步

完成上述修改后，不建议立即重新跑全部19个事件。

先选择5个事件进行对照：

```text
2021_0823
2022_0627
2023_0618
2023_0719
2020_0705
```

其中前4个是当前面积/雨量比明显偏低的事件，`2020_0705`作为面积较大的对照事件。

重点比较修改前后：

* `s2_count`
* `s2_valid_px`
* `n_high_flood_px`
* `n_medium_flood_px`
* `n_flood_px`
* `flood_area_km2`
* `flood_area_km2 / (rain_ref_mm / 100)`
* S1有效覆盖率
* S1前后影像数量

尤其需要观察：

> **缩短 S2 到5天以后，低面积事件的 High Flood 是否增加，同时 S1 的有效覆盖率是否保持稳定。**

如果结果稳定，再重新运行19个事件，并重新确定最终的 A/B/C 事件划分。