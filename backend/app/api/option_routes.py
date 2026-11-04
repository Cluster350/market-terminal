"""REST-Endpunkte der Optionen (OMON): Kennzahlen und Optionskette je US-Aktie."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from ..errors import TerminalError
from ..services import options as opt
from ..services.terminal import Terminal
from ..services.tickers import normalize

router = APIRouter(prefix="/api/options")


async def _load(t: Terminal, ticker: str):
    contracts = await t.options(ticker)
    q = (await t.quotes([ticker]))[0]
    return contracts, q.last


@router.get("/{ticker}/overview", response_model=opt.OptionsOverview)
async def options_overview(request: Request, ticker: str, exp: Optional[str] = Query(None, max_length=10)):
    t: Terminal = request.app.state.terminal
    tk = normalize(ticker)
    contracts, spot = await _load(t, tk)
    h = await t.history(tk)
    earnings = None
    try:
        e = await t.earnings(tk)
        if e.next and e.next.report_date:
            earnings = (e.next.report_date, e.next.timing)
    except TerminalError:
        pass  # ohne Termin keine E-Markierung
    return opt.overview(tk, contracts, spot, [c for c in h.c if c], t.now().date(), exp, earnings)


@router.get("/{ticker}/chain", response_model=opt.OptionChain)
async def options_chain(request: Request, ticker: str, exp: Optional[str] = Query(None, max_length=10)):
    t: Terminal = request.app.state.terminal
    tk = normalize(ticker)
    contracts, spot = await _load(t, tk)
    return opt.chain(tk, contracts, spot, t.now().date(), exp)
