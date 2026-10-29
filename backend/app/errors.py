"""Einheitliche Fehler, die das Frontend als Klartext anzeigen kann."""

from __future__ import annotations


class TerminalError(Exception):
    """Fehler mit HTTP-Status, maschinenlesbarem Code und deutscher Meldung."""

    status = 500
    code = "internal"

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status:
            self.status = status


class NotFound(TerminalError):
    status = 404
    code = "not_found"


class BadRequest(TerminalError):
    status = 400
    code = "bad_request"


class UpstreamError(TerminalError):
    """Datenquelle hat nicht oder fehlerhaft geantwortet."""

    status = 502
    code = "upstream"


class PlanNotIncluded(TerminalError):
    status = 403
    code = "plan"


class AuthError(TerminalError):
    status = 401
    code = "auth"


class BudgetExceeded(TerminalError):
    status = 429
    code = "budget"


class RateLimited(TerminalError):
    status = 429
    code = "rate_limited"
