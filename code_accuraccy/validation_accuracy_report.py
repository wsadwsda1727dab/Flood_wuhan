#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
validation_accuracy_report.py —— 伪标签精度验证：判读结果 -> 精度评价表

输入：validation_review.js 判读台导出的 CSV
      列示例：point_id, event_id, pseudo_label, longitude, latitude,
              conf_flood, conf_nonflood, VV, VH, VV_diff, VH_diff, VV_ratio,
              NDVI, MNDWI, DEM, slope, S2_Valid, reference, confidence

输出（控制台；加 --md / --out-csv 可同时落盘）：
    0 数据概况
    1 主精度表（逐事件 + 合计，含 Wilson 95% 置信区间）
    2 分档精度表（伪标签置信度 High / Medium）
    3 面积加权 OA（分层均衡抽样 vs 区域总体）
    4 人工判读置信度分层（稳健性检验）
    5 误差剖析（TP/FP/FN/TN 特征均值 + FP/FN 明细）
    6 自动提示

用法：
    python validation_accuracy_report.py                          # 用默认路径
    python validation_accuracy_report.py a.csv b.csv              # 多文件（多事件）
    python validation_accuracy_report.py <目录>                   # 目录下所有 CSV
    python validation_accuracy_report.py --md report.md --out-csv metrics.csv
    python validation_accuracy_report.py --detail 40 --drop-conf0

只依赖标准库，不需要 pandas / numpy。
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from statistics import mean

try:  # 保留控制台原生编码（避免在 cmd/GBK 终端里反而花屏），只兜住编码错误
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

# ============================================================================
# 配置
# ============================================================================
BASE_DIR = Path(r"D:\User\Documents\ChatGPT\c2\csvdata\validation_points")
DEFAULT_INPUTS = [BASE_DIR / "Wuhan_validation_reference_20200705.csv"]
SUMMARY_CSV = BASE_DIR / "Wuhan_2016_2025_validation_points_Summary.csv"

# 特征列（顺序即报告里的顺序）
FEATURES = ["VV", "VH", "VV_diff", "VH_diff", "VV_ratio",
            "NDVI", "MNDWI", "DEM", "slope", "S2_Valid"]

# 面积权重兜底表：event_id -> (n_flood_px, n_nonflood_px)，取自 Summary.csv
AREA_FALLBACK = {
    "Wuhan_2020_0705": (11298.301960784322, 348528.2666666652),
    "Wuhan_2021_0823": (667.3960784313724, 414228.5882352923),
    "Wuhan_2023_0618": (2941.133333333335, 239804.58823529293),
}

MIN_STRATUM_N = 30  # 低于此样本量的分档只作描述，不下结论
Z95 = 1.96


# ============================================================================
# 小工具
# ============================================================================
def disp_width(s: str) -> int:
    """中文按 2 个字符宽计算，保证控制台表格对齐。"""
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
               for ch in str(s))


def pad(s, width: int, align: str = "left") -> str:
    s = str(s)
    gap = max(0, width - disp_width(s))
    return s + " " * gap if align == "left" else " " * gap + s


def render_table(header, rows, aligns=None) -> list[str]:
    """按显示宽度对齐的纯文本表格。"""
    aligns = aligns or ["left"] * len(header)
    rows = [[("" if c is None else c) for c in r] for r in rows]
    widths = [disp_width(h) for h in header]
    for r in rows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], disp_width(c))

    def line(cells):
        return "| " + " | ".join(pad(c, widths[i], aligns[i])
                                 for i, c in enumerate(cells)) + " |"

    out = [line(header), "|" + "|".join("-" * (w + 2) for w in widths) + "|"]
    out += [line(r) for r in rows]
    return out


def fnum(v):
    """尽量转 float，失败返回 None（空串 / NA / None 都算缺失）。"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s == "" or s.upper() in ("NA", "NAN", "NULL"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def fmt(x, nd=4):
    return "NA" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{nd}f}"


def wilson(k: int, n: int, z: float = Z95):
    """Wilson 得分区间（比例型指标的 95% CI）。"""
    if n <= 0:
        return (None, None)
    p = k / n
    d = 1.0 + z * z / n
    c = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - half), min(1.0, c + half))


# ============================================================================
# 读数据
# ============================================================================
class Point:
    __slots__ = ("raw", "point_id", "event_id", "pseudo", "reference",
                 "confidence", "conf_flood", "conf_nonflood", "feat", "derived")

    def __init__(self, raw: dict):
        self.raw = raw
        self.point_id = (raw.get("point_id") or "").strip()
        self.event_id = (raw.get("event_id") or "UNKNOWN").strip()
        # 判读台导出叫 pseudo_label；早期样本表叫 label
        pseudo = raw.get("pseudo_label", raw.get("label"))
        self.pseudo = None if fnum(pseudo) is None else int(fnum(pseudo))
        ref = fnum(raw.get("reference"))
        self.reference = None if ref is None else int(ref)
        conf = fnum(raw.get("confidence"))
        self.confidence = None if conf is None else int(conf)
        cf = fnum(raw.get("conf_flood"))
        self.conf_flood = None if cf is None else int(cf)
        cn = fnum(raw.get("conf_nonflood"))
        self.conf_nonflood = None if cn is None else int(cn)
        self.feat = {k: fnum(raw.get(k)) for k in FEATURES}
        # 反算事件前向散射：VV_ratio = 10^(VV_post/10) / 10^(VV_pre/10)
        d = {}
        vv, ratio = self.feat.get("VV"), self.feat.get("VV_ratio")
        d["VV_pre"] = (vv - 10 * math.log10(ratio)) if (vv is not None and ratio and ratio > 0) else None
        vh, vhd = self.feat.get("VH"), self.feat.get("VH_diff")
        d["VH_pre"] = (vh - vhd) if (vh is not None and vhd is not None) else None
        self.derived = d

    # 伪标签置信度（2/1），用于分档
    @property
    def band(self):
        if self.pseudo == 1:
            return {2: "High", 1: "Medium"}.get(self.conf_flood, "?")
        if self.pseudo == 0:
            return {2: "High", 1: "Medium"}.get(self.conf_nonflood, "?")
        return "?"


def load_points(paths) -> list[Point]:
    pts: list[Point] = []
    for p in paths:
        with open(p, "r", encoding="utf-8-sig", newline="") as fh:
            for raw in csv.DictReader(fh):
                pts.append(Point(raw))
    return pts


def load_area_table():
    """从 Summary.csv 读面积权重；读不到就用内置兜底表。"""
    table = dict(AREA_FALLBACK)
    if SUMMARY_CSV.exists():
        try:
            with open(SUMMARY_CSV, "r", encoding="utf-8-sig", newline="") as fh:
                for row in csv.DictReader(fh):
                    ev = (row.get("event_id") or "").strip()
                    f, nf = fnum(row.get("n_flood_px")), fnum(row.get("n_nonflood_px"))
                    if ev and f and nf:
                        table[ev] = (f, nf)
        except Exception as exc:  # 读不了就退回兜底表
            print(f"[warn] 读取 Summary.csv 失败，改用内置面积表：{exc}")
    return table


# ============================================================================
# 指标
# ============================================================================
def confusion(pts):
    tp = fp = fn = tn = 0
    for p in pts:
        if p.pseudo is None or p.reference not in (0, 1):
            continue
        if p.pseudo == 1 and p.reference == 1:
            tp += 1
        elif p.pseudo == 1 and p.reference == 0:
            fp += 1
        elif p.pseudo == 0 and p.reference == 1:
            fn += 1
        elif p.pseudo == 0 and p.reference == 0:
            tn += 1
    return tp, fp, fn, tn


def metrics(pts) -> dict:
    tp, fp, fn, tn = confusion(pts)
    n = tp + fp + fn + tn
    m = {"N": n, "TP": tp, "FP": fp, "FN": fn, "TN": tn,
         "OA": None, "Precision": None, "Recall": None, "Specificity": None,
         "F1": None, "Kappa": None, "Pe": None}
    if n == 0:
        return m
    m["OA"] = (tp + tn) / n
    m["Precision"] = tp / (tp + fp) if (tp + fp) else None
    m["Recall"] = tp / (tp + fn) if (tp + fn) else None
    m["Specificity"] = tn / (tn + fp) if (tn + fp) else None
    if m["Precision"] is not None and m["Recall"] is not None and (m["Precision"] + m["Recall"]) > 0:
        m["F1"] = 2 * m["Precision"] * m["Recall"] / (m["Precision"] + m["Recall"])
    pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n)
    m["Pe"] = pe
    if pe < 1:
        m["Kappa"] = (m["OA"] - pe) / (1 - pe)
    return m


def metric_row(label: str, pts, area=None) -> list[str]:
    """一行指标；area=(n_flood_px, n_nonflood_px) 时追加面积加权 OA。"""
    m = metrics(pts)
    if m["N"] == 0:
        return [label, "0", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]
    lo_o, hi_o = wilson(m["TP"] + m["TN"], m["N"])
    row = [
        label, str(m["N"]),
        f'{m["TP"]}/{m["FP"]}/{m["FN"]}/{m["TN"]}',
        fmt(m["OA"]),
        f"{lo_o:.3f}-{hi_o:.3f}",
        fmt(m["Precision"]), fmt(m["Recall"]), fmt(m["Specificity"]),
        fmt(m["F1"]), fmt(m["Kappa"]),
    ]
    if area:
        f_px, nf_px = area
        w = f_px / (f_px + nf_px)
        if m["Recall"] is not None and m["Specificity"] is not None:
            row.append(fmt(w * m["Recall"] + (1 - w) * m["Specificity"]))
        else:
            row.append("-")
    return row


def precision_row(label: str, pts) -> list[str]:
    """单一类别子集（只看纯度）用的行：不显示 Recall/Specificity/Kappa，
    因为该子集里没有反例，这些列会退化成 1/0，容易误读。"""
    tp = sum(1 for p in pts if p.pseudo == 1 and p.reference == 1)
    fp = sum(1 for p in pts if p.pseudo == 1 and p.reference == 0)
    n = tp + fp
    if n == 0:
        return [label, "0", "-", "-", "-", "-"]
    lo, hi = wilson(tp, n)
    return [label, str(n), str(tp), str(fp), f"{tp / n:.4f}", f"{lo:.3f}-{hi:.3f}"]


def pid_order(p: Point):
    """point_id 末段数字排序（字符串排序会把 _113 排到 _4 前面）。"""
    tail = p.point_id.rsplit("_", 1)[-1]
    return (0, int(tail)) if tail.isdigit() else (1, p.point_id)


EXPORT_HEADER = ["stratum", "event_id", "N", "TP", "FP", "FN", "TN", "OA",
                 "Precision", "Recall", "Specificity", "F1", "Kappa", "Pe",
                 "MissRate"]


def export_rows(pts) -> list[list]:
    """--out-csv 的内容。

    单类别子集（只有伪 Flood 或只有伪 Non-Flood）里混淆矩阵缺一维，
    Recall / Specificity / Kappa 会退化成 1/0，所以这里一律留空，
    只保留该子集真正有意义的条件指标：
        伪 Flood 子集    -> Precision（纯度）
        伪 Non-Flood 子集 -> MissRate（漏检率 = FN/N）
    """
    out = []
    events = sorted({p.event_id for p in pts})
    groups = [(ev, [p for p in pts if p.event_id == ev]) for ev in events]
    groups.append(("ALL", pts))
    for ev, sub in groups:
        defs = [("全部", sub)]
        for band in ("High", "Medium"):
            defs.append((f"伪Flood {band}",
                         [p for p in sub if p.pseudo == 1 and p.band == band]))
            defs.append((f"伪NonFlood {band}",
                         [p for p in sub if p.pseudo == 0 and p.band == band]))
        defs.append(("伪Flood 合计", [p for p in sub if p.pseudo == 1]))
        defs.append(("伪NonFlood 合计", [p for p in sub if p.pseudo == 0]))
        for name, s in defs:
            m = metrics(s)
            if m["N"] == 0:
                continue
            has1 = (m["TP"] + m["FP"]) > 0   # 子集里有伪 Flood 点
            has0 = (m["TN"] + m["FN"]) > 0   # 子集里有伪 Non-Flood 点
            both = has1 and has0
            out.append([
                name, ev, m["N"], m["TP"], m["FP"], m["FN"], m["TN"],
                fmt(m["OA"]) if both else "NA",
                fmt(m["Precision"]) if has1 else "NA",
                fmt(m["Recall"]) if both else "NA",
                fmt(m["Specificity"]) if both else "NA",
                fmt(m["F1"]) if both else "NA",
                fmt(m["Kappa"]) if both else "NA",
                fmt(m["Pe"]) if both else "NA",
                fmt(m["FN"] / m["N"]) if (has0 and not has1) else "NA",
            ])
    return out


# ============================================================================
# 各章节
# ============================================================================
def sec_overview(pts) -> list[str]:
    out = ["", "=" * 78, "0 数据概况", "=" * 78]
    out.append(f"总点数：{len(pts)}")
    events = Counter(p.event_id for p in pts)
    out.append("事件：" + "，".join(f"{k}({v})" for k, v in sorted(events.items())))
    ids = [p.point_id for p in pts if p.point_id]
    out.append(f"point_id：{len(set(ids))} 个唯一值，重复 {len(ids) - len(set(ids))} 个")
    out.append("")
    out.append("类别与判读分布：")
    out += render_table(
        ["字段", "取值分布"],
        [["pseudo_label", str(dict(sorted(Counter(p.pseudo for p in pts).items(), key=lambda x: str(x[0]))))],
         ["conf_flood", str(dict(sorted(Counter(p.conf_flood for p in pts).items(), key=lambda x: str(x[0]))))],
         ["conf_nonflood", str(dict(sorted(Counter(p.conf_nonflood for p in pts).items(), key=lambda x: str(x[0]))))],
         ["reference（-1=Uncertain）", str(dict(sorted(Counter(p.reference for p in pts).items(), key=lambda x: str(x[0]))))],
         ["confidence（2/1/0）", str(dict(sorted(Counter(p.confidence for p in pts).items(), key=lambda x: str(x[0]))))]],
    )
    band = Counter((p.pseudo, p.band) for p in pts if p.pseudo in (0, 1))
    out.append("")
    out.append("伪标签置信度分档点数：")
    out += render_table(
        ["伪标签", "High", "Medium", "合计"],
        [["Flood(1)", band.get((1, "High"), 0), band.get((1, "Medium"), 0),
          sum(v for (ps, _), v in band.items() if ps == 1)],
         ["Non-Flood(0)", band.get((0, "High"), 0), band.get((0, "Medium"), 0),
          sum(v for (ps, _), v in band.items() if ps == 0)]],
        aligns=["left", "right", "right", "right"],
    )
    unc = [p.point_id for p in pts if p.reference == -1]
    if unc:
        out.append(f"Uncertain（reference=-1，不参与精度计算）：{len(unc)} 个 -> {', '.join(unc[:10])}")
    return out


def sec_main(pts, area_table) -> list[str]:
    out = ["", "=" * 78,
           "1 主精度表（剔除 reference=-1）", "=" * 78,
           "混淆矩阵：行 = 伪标签，列 = 人工判读 Reference",
           "判定顺序：TP 伪Flood&真Flood / FP 伪Flood&真NonFlood / "
           "FN 伪NonFlood&真Flood / TN 伪NonFlood&真NonFlood"]
    rows = []
    events = sorted({p.event_id for p in pts})
    for ev in events:
        sub = [p for p in pts if p.event_id == ev]
        rows.append(metric_row(ev, sub, area_table.get(ev)))
    rows.append(metric_row("ALL 合并", pts))
    header = ["事件", "N", "TP/FP/FN/TN", "OA", "OA 95%CI",
              "Precision", "Recall", "Specificity", "F1", "Kappa"]
    if any(area_table.get(e) for e in events):
        header.append("OA(面积加权)")
    out += render_table(header, rows,
                        aligns=["left", "right", "right"] + ["right"] * (len(header) - 3))
    out.append("")
    out.append("说明：OA=(TP+TN)/N；Precision=TP/(TP+FP) 伪Flood纯度；"
               "Recall=TP/(TP+FN) 真Flood召回；")
    out.append("      Specificity=TN/(TN+FP) 真Non-Flood判对率；"
               "Kappa 用文档第二十三节的 Pe 计算。")
    return out


def sec_bands(pts) -> list[str]:
    out = ["", "=" * 78, "2 分档精度表（伪标签置信度）", "=" * 78,
           "High = 有光学背书；Medium = 仅 SAR（无 S2 有效观测）"]

    def sel(pred):
        return [p for p in pts if pred(p)]

    rows = []
    # 伪 Flood 侧：看 Precision（纯度）。单类子集里 Recall/Kappa 会退化，故不显示。
    for band in ("High", "Medium"):
        sub = sel(lambda p, b=band: p.pseudo == 1 and p.band == b)
        rows.append(precision_row(f"伪Flood {band}", sub))
    rows.append(precision_row("伪Flood 合计", sel(lambda p: p.pseudo == 1)))
    out += render_table(
        ["档位", "N", "TP", "FP", "Precision(纯度)", "95%CI"],
        rows, aligns=["left", "right", "right", "right", "right", "right"])
    out.append("")
    # 伪 Non-Flood 侧：看漏检（FN）
    out.append("伪 Non-Flood 侧的漏检（这一档 Recall 恒为 0，看漏检率更直观）：")
    miss_rows = []
    for band in ("High", "Medium"):
        sub = sel(lambda p, b=band: p.pseudo == 0 and p.band == b)
        fn = sum(1 for p in sub if p.reference == 1)
        n = sum(1 for p in sub if p.reference in (0, 1))
        lo, hi = wilson(fn, n)
        miss_rows.append([f"伪Non-Flood {band}", n, fn,
                          "NA" if n == 0 else f"{fn / n:.4f}",
                          "NA" if n == 0 else f"{lo:.3f}-{hi:.3f}"])
    sub = sel(lambda p: p.pseudo == 0)
    fn = sum(1 for p in sub if p.reference == 1)
    n = sum(1 for p in sub if p.reference in (0, 1))
    lo, hi = wilson(fn, n)
    miss_rows.append(["伪Non-Flood 合计", n, fn, "NA" if n == 0 else f"{fn / n:.4f}",
                      "NA" if n == 0 else f"{lo:.3f}-{hi:.3f}"])
    out += render_table(["档位", "N", "FN(漏检)", "漏检率", "95%CI"],
                        miss_rows, aligns=["left", "right", "right", "right", "right"])
    return out


def sec_weighted(pts, area_table) -> list[str]:
    out = ["", "=" * 78, "3 面积加权 OA（分层均衡抽样的口径修正）", "=" * 78,
           "样本是每类等额抽取的，Non-Flood 被相对少抽 -> 样本 OA 会偏高；",
           "区域总体口径应按面积比例加权：OA_w = w_flood*Recall + w_nonflood*Specificity"]
    rows = []
    events = sorted({p.event_id for p in pts})
    for ev in events + ["ALL 合并"]:
        sub = pts if ev == "ALL 合并" else [p for p in pts if p.event_id == ev]
        m = metrics(sub)
        if m["OA"] is None:
            continue
        if ev == "ALL 合并":
            f_px = nf_px = 0.0
            for e, (f, nf) in area_table.items():
                if any(p.event_id == e for p in pts):
                    f_px += f
                    nf_px += nf
        else:
            if ev not in area_table:
                rows.append([ev, "NA", "NA", fmt(m["OA"]), "缺少面积权重"])
                continue
            f_px, nf_px = area_table[ev]
        w = f_px / (f_px + nf_px)
        oa_w = w * m["Recall"] + (1 - w) * m["Specificity"]
        rows.append([ev, f"{w * 100:.2f}%", f"{1 - w:.4f}",
                     fmt(m["OA"]), fmt(oa_w)])
    out += render_table(["事件", "洪水面积占比", "w_flood", "OA(样本均衡)", "OA(面积加权)"],
                        rows, aligns=["left", "right", "right", "right", "right"])
    out.append("")
    out.append("论文里两个都报：样本均衡 OA 是验证点上的精度，面积加权 OA 才能横向对比制图精度。")
    return out


def sec_confidence(pts, drop_zero: bool) -> list[str]:
    out = ["", "=" * 78, "4 人工判读置信度分层（稳健性检验）", "=" * 78,
           "confidence：2=高可信 / 1=一般可信 / 0=无法判断（非置信度）"]
    if drop_zero:
        out.append("本次已按 --drop-conf0 剔除 confidence=0 的点。")
    rows = []
    for c in ("2", "1", "0"):
        sub = [p for p in pts if str(p.confidence) == c and p.reference in (0, 1)]
        if not sub:
            continue
        rows.append(metric_row(f"confidence={c}", sub))
    rows.append(metric_row("全部", [p for p in pts if p.reference in (0, 1)]))
    out += render_table(
        ["子集", "N", "TP/FP/FN/TN", "OA", "OA 95%CI", "Precision",
         "Recall", "Specificity", "F1", "Kappa"],
        rows, aligns=["left", "right"] + ["right"] * 8)
    out.append("")
    out.append("若各档 OA/F1/Kappa 接近，说明结论不依赖判读者当时的主观把握程度。")
    return out


def sec_errors(pts, detail: int) -> list[str]:
    out = ["", "=" * 78, "5 误差剖析", "=" * 78]

    def group(pred):
        return [p for p in pts if pred(p) and p.reference in (0, 1)]

    quads = [
        ("TP 伪F&真F", group(lambda p: p.pseudo == 1 and p.reference == 1)),
        ("FP 伪F&真N", group(lambda p: p.pseudo == 1 and p.reference == 0)),
        ("FN 伪N&真F", group(lambda p: p.pseudo == 0 and p.reference == 1)),
        ("TN 伪N&真N", group(lambda p: p.pseudo == 0 and p.reference == 0)),
    ]
    cols = ["VV", "VV_pre", "VV_diff", "VH_diff", "MNDWI", "NDVI", "DEM", "slope", "S2_Valid"]
    rows = []
    for name, sub in quads:
        if not sub:
            continue
        cells = [name, str(len(sub))]
        for c in cols:
            vals = [(p.derived.get(c) if c in p.derived else p.feat.get(c)) for p in sub]
            vals = [v for v in vals if v is not None]
            cells.append(fmt(mean(vals), 2) if vals else "NA")
        rows.append(cells)
    out.append("四象限特征均值（VV_pre / VH_pre 由 VV 与 VV_ratio 反算，仅供诊断）：")
    out += render_table(["象限", "n"] + cols, rows,
                        aligns=["left", "right"] + ["right"] * len(cols))

    for tag, sub in (("FP 伪Flood 但人工判 Non-Flood", quads[1][1]),
                     ("FN 伪Non-Flood 但人工判 Flood", quads[2][1])):
        if not sub:
            continue
        out.append("")
        out.append(f"{tag} 明细（最多 {detail} 条，按序号排序）：")
        sub = sorted(sub, key=pid_order)
        rows = []
        for p in sub[:detail]:
            rows.append([
                p.point_id.replace("Wuhan_", ""), fmt(p.feat.get("VV"), 2),
                fmt(p.derived.get("VV_pre"), 2), fmt(p.feat.get("VV_diff"), 2),
                fmt(p.feat.get("VH_diff"), 2), fmt(p.feat.get("MNDWI"), 3),
                fmt(p.feat.get("NDVI"), 3),
                "NA" if p.feat.get("DEM") is None else f'{p.feat["DEM"]:.0f}',
                fmt(p.feat.get("slope"), 2),
                "NA" if p.feat.get("S2_Valid") is None else f'{p.feat["S2_Valid"]:.0f}',
                str(p.confidence),
            ])
        out += render_table(
            ["point_id", "VV", "VV_pre", "VV_diff", "VH_diff", "MNDWI",
             "NDVI", "DEM", "slope", "S2v", "conf"],
            rows, aligns=["left"] + ["right"] * 10)
        if len(sub) > detail:
            out.append(f"... 其余 {len(sub) - detail} 条省略（--detail 可调）")
        # 该组的证据画像
        with_opt = sum(1 for p in sub if (p.feat.get("MNDWI") or -9) > 0.2)
        dark_pre = sum(1 for p in sub if (p.derived.get("VV_pre") or 0) < -13)
        out.append(f"证据画像：MNDWI>0.2 的 {with_opt}/{len(sub)}；"
                   f"事件前 VV<-13dB（本来就是水面）的 {dark_pre}/{len(sub)}。")
    return out


def sec_notes(pts, area_table) -> list[str]:
    out = ["", "=" * 78, "6 自动提示", "=" * 78]
    notes = []
    m_all = metrics(pts)
    if m_all["N"]:
        notes.append(f"主表 N={m_all['N']}：OA={fmt(m_all['OA'])}, "
                     f"Precision={fmt(m_all['Precision'])}, Recall={fmt(m_all['Recall'])}, "
                     f"F1={fmt(m_all['F1'])}, Kappa={fmt(m_all['Kappa'])}")
    n_flood_pts = sum(1 for p in pts if p.pseudo == 1 and p.reference in (0, 1))
    n_non_pts = sum(1 for p in pts if p.pseudo == 0 and p.reference in (0, 1))
    if n_flood_pts == 0 or n_non_pts == 0:
        notes.append("[!] 只含单一伪标签类别：Precision/F1/Kappa 退化，必须先补齐另一类验证点。")
    # 分档样本量
    for band in ("High", "Medium"):
        n1 = sum(1 for p in pts if p.pseudo == 1 and p.band == band and p.reference in (0, 1))
        n0 = sum(1 for p in pts if p.pseudo == 0 and p.band == band and p.reference in (0, 1))
        if 0 < min(n1, n0) < MIN_STRATUM_N:
            notes.append(f"[!] {band} 档样本偏少（伪Flood n={n1}，伪Non-Flood n={n0}，"
                         f"低于 {MIN_STRATUM_N}），该档只作描述，CI 很宽，不要下强结论。")
    # 误检/漏检集中位置
    fp_hi = sum(1 for p in pts if p.pseudo == 1 and p.reference == 0 and p.band == "High")
    fp = sum(1 for p in pts if p.pseudo == 1 and p.reference == 0)
    if fp:
        notes.append(f"误检 {fp} 个，其中 High 档 {fp_hi} 个（{fp_hi / fp * 100:.0f}%）。")
    fn_hi = sum(1 for p in pts if p.pseudo == 0 and p.reference == 1 and p.band == "High")
    fn = sum(1 for p in pts if p.pseudo == 0 and p.reference == 1)
    if fn:
        notes.append(f"漏检 {fn} 个，其中 High 档 {fn_hi} 个（{fn_hi / fn * 100:.0f}%）。")
    # 多事件提示
    n_ev = len({p.event_id for p in pts})
    if n_ev < 2:
        notes.append(f"[!] 目前只有 {n_ev} 个事件：还要跑完其余事件，才能按文档第二十五节比较事件间稳定性。")
    notes.append("口径提醒：样本为每类等额的伪标签分层抽样 -> 主表 OA 是“验证点均衡精度”，"
                 "不能直接当制图总体精度（见第 3 节加权 OA）。")
    notes.append("若某档在事件中被判定为“永久/常态水体”，建议改记 reference=-1（Uncertain）"
                 "并在论文中说明，而不是简单计入 FP。")
    out += [f"- {n}" for n in notes]
    return out


# ============================================================================
# 入口
# ============================================================================
def resolve_inputs(args) -> list[Path]:
    if not args.inputs:
        return DEFAULT_INPUTS
    out: list[Path] = []
    for item in args.inputs:
        p = Path(item)
        if p.is_dir():
            out += sorted(p.glob("*.csv"))
        else:
            out.append(p)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="伪标签精度验证报告（读判读 CSV -> 精度表）")
    ap.add_argument("inputs", nargs="*", help="CSV 文件或目录；缺省用脚本内置路径")
    ap.add_argument("--md", help="把完整报告另存为 Markdown")
    ap.add_argument("--out-csv", help="把指标表导出为 CSV")
    ap.add_argument("--detail", type=int, default=20, help="FP/FN 明细打印条数（默认 20）")
    ap.add_argument("--drop-conf0", action="store_true",
                    help="剔除 confidence=0（无法判断）的点再计算")
    args = ap.parse_args(argv)

    paths = resolve_inputs(args)
    missing = [p for p in paths if not p.exists()]
    if missing:
        for p in missing:
            print(f"[error] 找不到文件：{p}")
        return 2
    if not paths:
        print("[error] 没有可读的 CSV")
        return 2

    pts = load_points(paths)
    if not pts:
        print("[error] CSV 里没有数据行")
        return 2
    if args.drop_conf0:
        pts = [p for p in pts if p.confidence != 0]

    area_table = load_area_table()

    lines: list[str] = []
    lines.append("伪标签精度验证报告（validation_accuracy_report.py）")
    lines.append("输入文件：")
    lines += [f"  - {p}" for p in paths]
    lines += sec_overview(pts)
    lines += sec_main(pts, area_table)
    lines += sec_bands(pts)
    lines += sec_weighted(pts, area_table)
    lines += sec_confidence(pts, args.drop_conf0)
    lines += sec_errors(pts, args.detail)
    lines += sec_notes(pts, area_table)

    text = "\n".join(lines)
    print(text)

    if args.out_csv:
        with open(args.out_csv, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(EXPORT_HEADER)
            w.writerows(export_rows(pts))
        print(f"\n[ok] 指标表已写出：{args.out_csv}")

    if args.md:
        with open(args.md, "w", encoding="utf-8") as fh:
            fh.write("# 伪标签精度验证报告\n\n```text\n")
            fh.write(text)
            fh.write("\n```\n")
        print(f"[ok] 报告已写出：{args.md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
