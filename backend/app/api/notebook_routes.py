"""Notebook (Funktion NB): Status, Start und Ende von JupyterLab auf dem eigenen Rechner."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..notebook import NotebookService, NotebookStatus

router = APIRouter(prefix="/api/notebook")


def _nb(request: Request) -> NotebookService:
    return request.app.state.notebook


@router.get("", response_model=NotebookStatus)
async def notebook_status(request: Request):
    return _nb(request).status()


@router.post("/start", response_model=NotebookStatus)
async def notebook_start(request: Request):
    return await _nb(request).start()


@router.post("/stop", response_model=NotebookStatus)
async def notebook_stop(request: Request):
    return await _nb(request).stop()
