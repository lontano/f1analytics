from fastapi import APIRouter, Depends

from app.deps import require_user
from app.services.auth_session import SessionUser

router = APIRouter(prefix="/v1", tags=["me"])


@router.get("/me")
def me(user: SessionUser = Depends(require_user)) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}
