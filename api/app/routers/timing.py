from fastapi import APIRouter, Depends

from app.demo_timing import timing_snapshot
from app.deps import require_user
from app.services.auth_session import SessionUser

router = APIRouter(prefix="/v1", tags=["timing"])


@router.get("/timing/snapshot")
def snapshot(_user: SessionUser = Depends(require_user)) -> dict:
    return timing_snapshot()
