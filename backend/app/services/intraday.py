"""Intraday-Kerzen: Intervalle zusammenfassen und mit Echtzeit-Minutenkerzen ergänzen."""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

from ..models import Intraday

INTERVALS = ("1m", "5m", "15m", "1h")
MINUTES = {"1m": 1, "5m": 5, "15m": 15, "1h": 60}
# Von den Datenquellen direkt geliefert; 15 Minuten wird aus 5-Minuten-Kerzen gebildet
NATIVE = {"1m": "1m", "5m": "5m", "15m": "5m", "1h": "1h"}


def bucket(ts: int, minutes: int) -> int:
    """Beginn des Intervalls (Unix-Sekunden), an der Uhr ausgerichtet (9:30, 9:45 …)."""
    step = minutes * 60
    return ts - ts % step


def aggregate(data: Intraday, interval: str) -> Intraday:
    """Kerzen zu einem gröberen Intervall zusammenfassen (Eröffnung erste, Schluss letzte Kerze)."""
    minutes = MINUTES[interval]
    out = Intraday(ticker=data.ticker, interval=interval, t=[], o=[], h=[], l=[], c=[], v=[])
    for ts, o, h, l, c, v in zip(data.t, data.o, data.h, data.l, data.c, data.v):
        if c is None:
            continue
        b = bucket(ts, minutes)
        if out.t and out.t[-1] == b:
            out.h[-1] = _max(out.h[-1], h if h is not None else c)
            out.l[-1] = _min(out.l[-1], l if l is not None else c)
            out.c[-1] = c
            out.v[-1] = None if out.v[-1] is None and v is None else (out.v[-1] or 0) + (v or 0)
        else:
            out.t.append(b)
            out.o.append(o if o is not None else c)
            out.h.append(h if h is not None else c)
            out.l.append(l if l is not None else c)
            out.c.append(c)
            out.v.append(v)
    return out


def _max(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return b if a is None else a if b is None else max(a, b)


def _min(a: Optional[float], b: Optional[float]) -> Optional[float]:
    return b if a is None else a if b is None else min(a, b)


def merge_minutes(data: Intraday, minutes: Iterable[Sequence[float]]) -> Intraday:
    """Echtzeit-Minutenkerzen (ts, o, h, l, c, v) anhängen bzw. jüngere Kerzen ersetzen.

    Die Datenquelle liefert die Kerzen des laufenden Tages oft erst Stunden später; was der
    Echtzeit-Strom seit dem Abonnieren gesehen hat, füllt diese Lücke.
    """
    rows = sorted((int(m[0]), *m[1:]) for m in minutes)
    if not rows:
        return data
    live = Intraday(ticker=data.ticker, interval="1m", t=[r[0] for r in rows], o=[r[1] for r in rows], h=[r[2] for r in rows],
                    l=[r[3] for r in rows], c=[r[4] for r in rows], v=[r[5] for r in rows])
    if data.interval != "1m":
        live = aggregate(live, data.interval if data.interval in MINUTES else "5m")
    last = data.t[-1] if data.t else -1
    out = Intraday(ticker=data.ticker, interval=data.interval, t=list(data.t), o=list(data.o), h=list(data.h),
                   l=list(data.l), c=list(data.c), v=list(data.v))
    for ts, o, h, l, c, v in zip(live.t, live.o, live.h, live.l, live.c, live.v):
        if ts < last:
            continue
        if ts == last and out.t:
            # laufende Kerze der Datenquelle mit dem Strom ergänzen
            out.h[-1] = _max(out.h[-1], h)
            out.l[-1] = _min(out.l[-1], l)
            out.c[-1] = c
            continue
        out.t.append(ts)
        out.o.append(o)
        out.h.append(h)
        out.l.append(l)
        out.c.append(c)
        out.v.append(v)
    return out
