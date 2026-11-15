"""Deep-dive numbers for the Mental Wellbeing page, self-report side
(GET /api/v1/wellbeing/{astronaut_id}/insight).

Rule of this module: nothing is typed in and nothing is guessed. It reads what the astronaut stored
through Daily Check-in (wellbeing_assessments + cognitive_assessments) and returns plain numbers:

  metrics    mood / stress / fatigue / sleep quality: daily series, the astronaut's OWN usual range
             (built from the earlier check-ins, so today is not compared with itself), where the
             latest check-in sits against it, the concern line from the wellbeing rules, direction
  concerns   concern level of every check-in, daily strip, check-ins in a row at medium/high concern,
             the most common concern
  cognitive  reaction time / attention / memory / accuracy against the astronaut's own baseline
  links      how the four scales move together inside this astronaut's own history, and what mood and
             stress look like the day after a poorer night
  pattern    decline detector (several indicators drifting the same way = the isolation-type signature)
  journal    the latest notes, with the scores of that day
  reading    plain-language findings built from the blocks above

A block that cannot be computed (too few check-ins) is left out of the answer, never filled with a default.
Thresholds already defined in app/wellbeing/assessment_service.py are reused as they are (concern rules,
trend direction, cognitive baseline). The extra design choices are written below so the team can read them.
Decision-support only: nothing here is a psychiatric or medical diagnosis.
"""
import math
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from statistics import mean, median, pstdev

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.repositories import astronaut_repo, wellbeing_repo
from app.schemas.observation import to_utc
from app.schemas.wellbeing import NOTE, SCALE_MAX, SCALE_MIN
from app.wellbeing import assessment_service as svc

# ---- design choices (written here so the team can read and change them) ---------------------
MIN_FOR_USUAL = 5          # earlier check-ins needed before "your usual range" is drawn
SD_FLOOR = 0.5             # scales are whole numbers, so a flat history still gets a usable spread
Z_OUTSIDE = 1.0            # more than 1 SD from the usual mean = outside the astronaut's own usual range
MIN_DAYS_FOR_LINKS = 6     # days with a check-in needed before the scales are compared with each other
MIN_PER_GROUP = 3          # next-day comparison needs this many days in each group
RUN_LEVELS = ("medium", "high")   # concern levels that count toward "check-ins in a row"
RAISE_WORSENING = 3        # this many of the 4 scales worsening = raise it with the medical officer
RAISE_RUN = 3              # this many check-ins in a row at medium/high concern = raise it
JOURNAL_ENTRIES = 6

METRICS = [  # (key, label, higher_is_better)
    ("mood", "Mood", True),
    ("stress", "Stress", False),
    ("fatigue", "Fatigue", False),
    ("sleep_quality", "Sleep quality", True),
]
COGNITIVE = {  # key: (label, unit)
    "reaction_time_ms": ("Reaction time", "ms"),
    "attention_score": ("Attention", "/100"),
    "memory_score": ("Memory", "/100"),
    "task_accuracy": ("Task accuracy", "%"),
}
LABEL = {k: label for k, label, _ in METRICS}


# ---------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------
def _r(x, nd=2):
    return None if x is None or not math.isfinite(float(x)) else round(float(x), nd)


def _strength(r):
    a = abs(r)
    return "strong" if a >= 0.6 else "moderate" if a >= 0.4 else "weak" if a >= 0.2 else "negligible"


def _spearman(xs, ys):
    """(r, p) or None when one series is flat or too short. scipy ships with scikit-learn."""
    if len(xs) < 4 or len(set(xs)) < 2 or len(set(ys)) < 2:
        return None
    try:
        from scipy.stats import spearmanr
        res = spearmanr(xs, ys)
        r, p = float(res.statistic), float(res.pvalue)
    except Exception:  # noqa: BLE001  no scipy: report no correlation instead of a made-up one
        return None
    return (r, p) if math.isfinite(r) else None


def _join(words):
    words = list(words)
    if len(words) <= 1:
        return "".join(words)
    return ", ".join(words[:-1]) + " and " + words[-1]


def _concern_lines():
    """{metric: {level: {op, value, message}}} straight from the backend concern rules."""
    out = {}
    for metric, op, threshold, level, message in svc.CONCERN_RULES:
        out.setdefault(metric, {})[level] = {"op": op, "value": threshold, "message": message}
    return out


def _past(line, v):
    return line is not None and ((line["op"] == "ge" and v >= line["value"]) or (line["op"] == "le" and v <= line["value"]))


def _line_text(line):
    return None if line is None else f"{'at or above' if line['op'] == 'ge' else 'at or below'} {line['value']}"


# ---------------------------------------------------------------------------------------------
# blocks
# ---------------------------------------------------------------------------------------------
def _metric_blocks(window, trends, start, end):
    lines = _concern_lines()
    direction = {t.metric: t.direction for t in trends.wellbeing}
    mid = start + (end - start) / 2
    out = []
    for key, label, higher in METRICS:
        pts = [(to_utc(a.assessed_at), float(getattr(a, key))) for a in window]
        vals = [v for _, v in pts]
        per_day = defaultdict(list)
        for t, v in pts:
            per_day[t.date()].append(v)
        early = [v for t, v in pts if t < mid]
        late = [v for t, v in pts if t >= mid]
        latest = vals[-1]
        usual = None
        prev = vals[:-1]
        if len(prev) >= MIN_FOR_USUAL:
            m = mean(prev)
            sd = max(pstdev(prev), SD_FLOOR)
            z = (latest - m) / sd
            usual = {
                "mean": _r(m, 1), "sd": _r(sd), "n": len(prev),
                "low": _r(max(SCALE_MIN, m - sd * Z_OUTSIDE), 1), "high": _r(min(SCALE_MAX, m + sd * Z_OUTSIDE), 1),
                "latest_z": _r(z), "latest_vs_usual": "above" if z > Z_OUTSIDE else "below" if z < -Z_OUTSIDE else "typical",
                "latest_difference": _r(latest - m),
                "latest_is_worse": (z < -Z_OUTSIDE) if higher else (z > Z_OUTSIDE),
            }
        medium = lines.get(key, {}).get("medium")
        high = lines.get(key, {}).get("high")
        out.append({
            "key": key, "label": label, "higher_is_better": higher,
            "count": len(vals), "latest": latest, "mean": _r(mean(vals)), "min": min(vals), "max": max(vals),
            "direction": direction.get(key, "insufficient_data"),
            "first_half_mean": _r(mean(early)) if early else None,
            "second_half_mean": _r(mean(late)) if late else None,
            "half_change": _r(mean(late) - mean(early)) if early and late else None,
            "usual": usual,
            "concern_line": medium, "high_line": high,
            "days_past_line": sum(1 for v in vals if _past(medium, v)),
            "share_past_line": _r(sum(1 for v in vals if _past(medium, v)) / len(vals), 3),
            "daily": [{"date": d.isoformat(), "mean": _r(mean(v)), "count": len(v)} for d, v in sorted(per_day.items())],
        })
    return out


def _runs(levels, times):
    """Check-ins in a row at medium/high concern: the current run and the longest run."""
    cur = 0
    for lv in reversed(levels):
        if lv in RUN_LEVELS:
            cur += 1
        else:
            break
    best = best_start = 0
    run = 0
    start_i = 0
    for i, lv in enumerate(levels):
        if lv in RUN_LEVELS:
            if run == 0:
                start_i = i
            run += 1
            if run > best:
                best, best_start = run, start_i
        else:
            run = 0
    longest = None
    if best:
        longest = {"checkins": best, "start": times[best_start].date().isoformat(),
                   "end": times[best_start + best - 1].date().isoformat()}
    return cur, longest


def _concern_block(reads, times, end):
    levels = [r.performance_concern_level for r in reads]
    counts = {lv: levels.count(lv) for lv in svc.LEVELS}
    order = {lv: i for i, lv in enumerate(svc.LEVELS)}
    by_day = {}
    for r, t in zip(reads, times):
        d = t.date()
        slot = by_day.setdefault(d, {"level": "none", "concerns": {}, "checkins": 0})
        slot["checkins"] += 1
        if order[r.performance_concern_level] > order[slot["level"]]:
            slot["level"] = r.performance_concern_level
        for c in r.concerns:
            old = slot["concerns"].get(c.metric)
            if old is None or order[c.level] > order[old["level"]]:
                slot["concerns"][c.metric] = {"metric": c.metric, "level": c.level, "message": c.message, "value": c.value}
    strip = [{"date": d.isoformat(), "level": s["level"], "checkins": s["checkins"], "concerns": list(s["concerns"].values())}
             for d, s in sorted(by_day.items())]

    cur_run, longest = _runs(levels, times)
    common = Counter((c.metric, c.message) for r in reads for c in r.concerns)
    flagged_idx = [i for i, lv in enumerate(levels) if lv in RUN_LEVELS]
    last_concern = times[flagged_idx[-1]].date() if flagged_idx else None
    return {
        "checkins": len(levels), "counts": counts,
        "flagged_checkins": len(flagged_idx), "flagged_share": _r(len(flagged_idx) / len(levels), 3),
        "strip": strip,
        "current_run": cur_run, "longest_run": longest,
        "last_concern_date": last_concern.isoformat() if last_concern else None,
        "days_since_last_concern": (end.date() - last_concern).days if last_concern else None,
        "latest_level": levels[-1],
        "most_common": [{"metric": m, "label": LABEL.get(m, m), "message": msg, "count": n, "share": _r(n / len(levels), 3)}
                        for (m, msg), n in common.most_common(4)],
    }


def _cognitive_block(trends, all_cognitive):
    rows = []
    for t in trends.cognitive:
        label, unit = COGNITIVE.get(t.metric, (t.metric.replace("_", " ").capitalize(), ""))
        rows.append({
            "key": t.metric, "label": label, "unit": unit, "higher_is_better": t.higher_is_better,
            "count": t.count, "latest": _r(t.latest), "mean": _r(t.mean) if t.count else None,
            "direction": t.direction,
            "baseline_mean": t.baseline_mean, "baseline_n": t.baseline_n, "recent_mean": t.recent_mean,
            "change_percent": t.change_percent, "deviates": t.deviates_from_baseline,
            "message": (f"Recent {label.lower()} is {abs(t.change_percent):.0f}% {'lower' if t.change_percent < 0 else 'higher'} than your baseline "
                        f"({t.baseline_mean:g} to {t.recent_mean:g}{(' ' + unit) if unit else ''}), a possible performance concern, not a diagnosis."
                        if t.deviates_from_baseline and t.change_percent is not None else None),
            "daily": [{"date": d.date.isoformat(), "mean": d.mean} for d in t.daily],
        })
    if not rows:
        return None
    return {"tests_total": len(all_cognitive), "metrics": rows,
            "baseline_rule": f"Baseline = first {svc.BASELINE_N} tests; compared with the latest {svc.RECENT_N}; "
                             f"flagged when {svc.BASELINE_DEVIATION_PCT:g}% worse. Needs {svc.BASELINE_N + svc.RECENT_N}+ tests."}


def _links_block(window):
    per_day = defaultdict(lambda: defaultdict(list))
    for a in window:
        d = to_utc(a.assessed_at).date()
        for key, _, _ in METRICS:
            per_day[d][key].append(float(getattr(a, key)))
    days = sorted(per_day)
    series = {key: [mean(per_day[d][key]) for d in days] for key, _, _ in METRICS}
    if len(days) < MIN_DAYS_FOR_LINKS:
        return None

    pairs = []
    keys = [k for k, _, _ in METRICS]
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            res = _spearman(series[a], series[b])
            if res is None:
                continue
            r, p = res
            pairs.append({"a": a, "b": b, "a_label": LABEL[a], "b_label": LABEL[b], "r": _r(r), "p": _r(p, 3), "n": len(days),
                          "strength": _strength(r), "together": r > 0})
    pairs.sort(key=lambda x: abs(x["r"]), reverse=True)

    # What the day AFTER a poorer night looks like (consecutive calendar days only).
    by_date = dict(zip(days, range(len(days))))
    nxt = []
    for d in days:
        n = d + timedelta(days=1)
        if n in by_date:
            nxt.append((series["sleep_quality"][by_date[d]], {k: series[k][by_date[n]] for k in ("mood", "stress", "fatigue")}))
    next_day = None
    if len(nxt) >= 2 * MIN_PER_GROUP:
        thr = median(s for s, _ in nxt)
        poor = [t for s, t in nxt if s < thr]
        good = [t for s, t in nxt if s >= thr]
        if len(poor) >= MIN_PER_GROUP and len(good) >= MIN_PER_GROUP:
            rows = []
            for k in ("mood", "stress", "fatigue"):
                pm, gm = mean(t[k] for t in poor), mean(t[k] for t in good)
                rows.append({"key": k, "label": LABEL[k], "after_poorer_night": _r(pm), "after_better_night": _r(gm),
                             "difference": _r(pm - gm)})
            next_day = {"threshold": _r(thr), "n_poorer": len(poor), "n_better": len(good), "rows": rows}
    return {"days": len(days), "pairs": pairs, "next_day": next_day,
            "note": "Spearman rank correlation over this astronaut's own daily means. A link is a pattern in this one history, not a cause."}


def _pattern_block(metrics, cognitive, concern):
    dirs = {m["key"]: m["direction"] for m in metrics}
    testable = sum(1 for d in dirs.values() if d != "insufficient_data")
    worse = [LABEL[k] for k, d in dirs.items() if d == "worsening"]
    better = [LABEL[k] for k, d in dirs.items() if d == "improving"]
    cog_dev = [m["label"] for m in (cognitive or {}).get("metrics", []) if m["deviates"]]
    run = concern["current_run"]
    if not testable and not cog_dev and not run:
        return None

    if len(worse) >= RAISE_WORSENING or (len(worse) >= 2 and cog_dev) or run >= RAISE_RUN:
        verdict, tone, title = "raise", "bad", "A decline pattern is building"
    elif worse or cog_dev or concern["latest_level"] in RUN_LEVELS:
        verdict, tone, title = "watch", "warn", "One or two signals are drifting the wrong way"
    else:
        verdict, tone, title = "steady", "ok", "No decline pattern in this window"

    parts = []
    if worse:
        parts.append(f"{_join(worse)} got worse (second half of the window against the first)")
    if cog_dev:
        parts.append(f"{_join([c.lower() for c in cog_dev])} {'is' if len(cog_dev) == 1 else 'are'} {svc.BASELINE_DEVIATION_PCT:g}% or more worse than baseline")
    if run >= 2:
        parts.append(f"the last {run} check-ins in a row were at medium or high concern")
    if verdict == "steady":
        text = (f"None of the {testable} scales that could be compared got worse"
                + (f"; {_join(better).lower()} improved" if better else "") + ". Keep the normal check-in routine.")
    else:
        text = "; ".join(parts)
        text = text[0].upper() + text[1:] + "."
        if verdict == "raise":
            text += (" Several indicators drifting the same way is the shape that long confinement and heavy workload tend to produce, "
                     "so it is worth talking to the crew medical officer. It is a prompt to talk, not a diagnosis.")
        else:
            text += " Check again after the next few check-ins; a second indicator joining would make this a pattern."
    return {
        "verdict": verdict, "tone": tone, "title": title, "text": text,
        "worsening": worse, "improving": better, "cognitive_deviations": cog_dev, "indicators_compared": testable,
        "rule": (f"Raise = {RAISE_WORSENING}+ of the 4 scales worsening, or 2 worsening together with a cognitive baseline deviation, "
                 f"or {RAISE_RUN}+ check-ins in a row at medium/high concern. Watch = anything less that still drifts or deviates. "
                 "Design choice, not a clinical cut-off."),
    }


def _journal_block(window, reads_by_id):
    rows = []
    for a in reversed(window):
        text = (a.notes or "").strip()
        if not text:
            continue
        rows.append({
            "date": to_utc(a.assessed_at).isoformat(), "mood": a.mood, "stress": a.stress, "fatigue": a.fatigue,
            "sleep_quality": a.sleep_quality, "level": reads_by_id[a.id].performance_concern_level, "text": text,
        })
        if len(rows) >= JOURNAL_ENTRIES:
            break
    total = sum(1 for a in window if (a.notes or "").strip())
    return {"entries": rows, "total_with_notes": total} if rows else None


def _reading(metrics, concern, cognitive, links, pattern):
    cards = []
    outside = [m for m in metrics if m["usual"] and m["usual"]["latest_vs_usual"] != "typical"]
    for m in outside:
        u = m["usual"]
        word = "above" if u["latest_vs_usual"] == "above" else "below"
        cards.append({
            "tone": "warn" if u["latest_is_worse"] else "ok",
            "title": f"{m['label']} is {word} your usual",
            "text": (f"Latest {m['label'].lower()} is {m['latest']:g} against your usual {u['mean']:g} "
                     f"(range {u['low']:g} to {u['high']:g}, from {u['n']} earlier check-ins)."
                     + (f" That is {'past' if _past(m['concern_line'], m['latest']) else 'not past'} the concern line ({_line_text(m['concern_line'])})."
                        if m["concern_line"] else "")),
            "evidence": "convention",
        })
    with_usual = [m for m in metrics if m["usual"]]
    if with_usual and not outside:
        cards.append({"tone": "ok", "title": "Latest check-in is inside your own usual range",
                      "text": f"All {len(with_usual)} scales sit within one spread of your earlier check-ins.", "evidence": "convention"})

    run = concern["current_run"]
    if run >= 2:
        cards.append({"tone": "bad" if run >= RAISE_RUN else "warn", "title": f"{run} check-ins in a row at medium or high concern",
                      "text": "A run matters more than one bad day. Look at which scale keeps tripping the concern line below.",
                      "evidence": "convention"})
    elif concern["longest_run"] and concern["longest_run"]["checkins"] >= RAISE_RUN and run == 0:
        lr = concern["longest_run"]
        cards.append({"tone": "ok", "title": "A rough stretch has passed",
                      "text": f"{lr['checkins']} check-ins in a row were at medium or high concern ({lr['start']} to {lr['end']}); the latest check-in is back below that.",
                      "evidence": "convention"})
    elif concern["most_common"] and concern["flagged_checkins"]:
        top = concern["most_common"][0]
        cards.append({"tone": "warn", "title": f"{top['message']} comes up most",
                      "text": f"{top['count']} of {concern['checkins']} check-ins ({round(top['share'] * 100)}%) crossed this concern line.",
                      "evidence": "convention"})

    if pattern:
        cards.append({"tone": pattern["tone"], "title": pattern["title"], "text": pattern["text"], "evidence": "convention"})

    nd = (links or {}).get("next_day")
    if nd:
        mood = next(r for r in nd["rows"] if r["key"] == "mood")
        stress = next(r for r in nd["rows"] if r["key"] == "stress")
        if abs(mood["difference"]) >= 0.5 or abs(stress["difference"]) >= 0.5:
            cards.append({
                "tone": "warn" if (mood["difference"] <= -0.5 or stress["difference"] >= 0.5) else "ok",
                "title": "Your next day follows your sleep",
                "text": (f"After nights rated below {nd['threshold']:g}, mood averaged {mood['after_poorer_night']:g} against {mood['after_better_night']:g} "
                         f"after better nights, and stress {stress['after_poorer_night']:g} against {stress['after_better_night']:g} "
                         f"({nd['n_poorer']} and {nd['n_better']} days)."),
                "evidence": "proxy",
            })
    for c in (cognitive or {}).get("metrics", []):
        if c["deviates"] and c["message"]:
            cards.append({"tone": "warn", "title": f"{c['label']} is off your baseline", "text": c["message"], "evidence": "convention"})
    return cards


# ---------------------------------------------------------------------------------------------
def get_wellbeing_insight(db: Session, astronaut_id: int, days: int = 30) -> dict:
    if astronaut_repo.get(db, astronaut_id) is None:
        raise AppError(404, "Astronaut not found")

    newest, total = wellbeing_repo.list_for_astronaut(db, astronaut_id, 0, 1)
    if not newest:
        return {"available": False, "astronaut_id": astronaut_id,
                "reason": "No self-reported check-in has been stored for this astronaut yet.",
                "scale": {"min": SCALE_MIN, "max": SCALE_MAX}, "disclaimer": NOTE}

    # The window ends at the newest check-in, so a quiet few days does not empty the page.
    end = to_utc(newest[0].assessed_at)
    start = end - timedelta(days=days)
    window = wellbeing_repo.in_window(db, astronaut_id, start, end)
    all_cog = wellbeing_repo.all_cognitive(db, astronaut_id)
    trends = svc.compute_trends(astronaut_id, window, all_cog, start, end, days)

    reads = [svc.to_read(a) for a in window]
    times = [to_utc(a.assessed_at) for a in window]
    reads_by_id = {a.id: r for a, r in zip(window, reads)}

    metrics = _metric_blocks(window, trends, start, end)
    concern = _concern_block(reads, times, end)
    cognitive = _cognitive_block(trends, all_cog)
    links = _links_block(window)
    pattern = _pattern_block(metrics, cognitive, concern)

    return {
        "available": True, "astronaut_id": astronaut_id,
        "window": {"days": days, "start": start.isoformat(), "end": end.isoformat(),
                   "days_since_latest": max(0, (datetime.now(UTC) - end).days), "total_checkins_ever": total},
        "checkins": len(window), "days_with_checkins": len({t.date() for t in times}),
        "scale": {"min": SCALE_MIN, "max": SCALE_MAX},
        "rules": {"min_for_usual": MIN_FOR_USUAL, "min_days_for_links": MIN_DAYS_FOR_LINKS,
                  "cognitive_tests_needed": svc.BASELINE_N + svc.RECENT_N},
        "metrics": metrics, "concerns": concern, "cognitive": cognitive, "links": links, "pattern": pattern,
        "journal": _journal_block(window, reads_by_id),
        "reading": _reading(metrics, concern, cognitive, links, pattern),
        "method_note": (
            f"Your usual range = mean ± {Z_OUTSIDE:g} spread of the earlier check-ins in the window (needs {MIN_FOR_USUAL}+; "
            f"spread never below {SD_FLOOR:g} because the scales are whole numbers). {svc.METHOD_NOTE}"),
        "disclaimer": NOTE,
    }
