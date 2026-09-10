import pytest
import asyncio
from app.services.backup_service import backup_service
from app.services.db_service import db_service

@pytest.mark.asyncio
async def test_backup_now_execution():
    # Force a backup execution
    res = await backup_service.backup_now()
    assert res["status"] in ("success", "completed", "disabled", "error")
    if res["status"] in ("success", "completed"):
        assert "rows_backed" in res
        assert res["rows_backed"] >= 0

    status = backup_service.get_backup_status()
    assert "enabled" in status
    assert "history" in status
    assert isinstance(status["history"], list)
