import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends

from app.config import settings, get_setting
from app.services.db_service import db_service
from app.services.backup_service import backup_service
from app.routers.auth import verify_admin_pin
from app.schemas import (
    FoodClaimRequest,
    FoodUpdateRequest,
    FoodGroupCreateRequest,
    FoodGroupUpdateRequest,
    FoodGroupReorderRequest,
    FoodItemCreateRequest,
    FoodItemUpdateRequest,
    FoodServingNoteRequest,
    FoodToggleRequest,
    SignupToggleRequest,
)

logger = logging.getLogger("food-router")

router = APIRouter(tags=["food"])


# =============================================================================
# PUBLIC FOOD SIGNUP / CLAIM / UPDATE / RELEASE
# =============================================================================

@router.post("/api/signup/food")
async def claim_food_item_endpoint(payload: FoodClaimRequest):
    food_enabled = bool(get_setting("food_signup_enabled", settings.signup.food_signup_enabled))
    if not food_enabled:
        raise HTTPException(status_code=400, detail="Food sign-up is currently disabled.")

    if not payload.signer_name.strip():
        raise HTTPException(status_code=400, detail="Signer name is required.")

    try:
        signup_id = db_service.claim_food_item(
            item_id=payload.item_id,
            signer_name=payload.signer_name,
            dish_description=payload.dish_description or "",
            signer_phone=payload.signer_phone or ""
        )
        backup_service.trigger_backup()

        item_name = payload.item_id
        for it in db_service.get_all_food_items_with_signups():
            if it.get("item_id") == payload.item_id:
                item_name = it.get("name", item_name)
                break
        dish_text = f" ({payload.dish_description})" if payload.dish_description else ""
        dump_dict = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        db_service.log_activity(
            action_type="food_claim",
            performer_name=payload.signer_name,
            summary=f"Claimed potluck dish '{item_name}'{dish_text}",
            details=json.dumps(dump_dict),
            source="performer_hub"
        )

        return {"status": "success", "signup_id": signup_id}
    except ValueError as ex:
        raise HTTPException(status_code=409, detail=str(ex))


@router.put("/api/signup/food/{signup_id}")
async def update_food_signup_endpoint(signup_id: str, payload: FoodUpdateRequest):
    all_items_before = db_service.get_all_food_items_with_signups()
    target_before = next((it for it in all_items_before if it.get("signup_id") == signup_id), None)
    signer = target_before.get("signer_name", "Participant") if target_before else "Participant"

    try:
        success = db_service.update_food_signup(
            signup_id=signup_id,
            item_id=payload.item_id,
            dish_description=payload.dish_description
        )
        if not success:
            raise HTTPException(status_code=404, detail="Food sign-up not found.")
        backup_service.trigger_backup()

        new_item_name = ""
        if payload.item_id:
            new_it = next((it for it in all_items_before if it.get("item_id") == payload.item_id), None)
            if new_it:
                new_item_name = new_it.get("name", "")
        dish_txt = f" ({payload.dish_description})" if payload.dish_description else ""
        dump_dict = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        db_service.log_activity(
            action_type="food_update",
            performer_name=signer,
            summary=f"Updated food sign-up to '{new_item_name or (target_before.get('name') if target_before else 'dish')}'{dish_txt}",
            details=json.dumps(dump_dict),
            source="performer_hub"
        )

        return {"status": "success"}
    except ValueError as ex:
        raise HTTPException(status_code=409, detail=str(ex))


@router.delete("/api/signup/food/{signup_id}")
async def release_food_signup_endpoint(signup_id: str):
    all_items_before = db_service.get_all_food_items_with_signups()
    target_before = next((it for it in all_items_before if it.get("signup_id") == signup_id), None)
    signer = target_before.get("signer_name", "Participant") if target_before else "Participant"
    item_name = target_before.get("name", "potluck dish") if target_before else "potluck dish"

    success = db_service.release_food_signup(signup_id)
    if not success:
        raise HTTPException(status_code=404, detail="Food sign-up not found.")
    backup_service.trigger_backup()

    db_service.log_activity(
        action_type="food_release",
        performer_name=signer,
        summary=f"Released potluck dish '{item_name}'",
        details=json.dumps({"signup_id": signup_id, "item_name": item_name}),
        source="performer_hub"
    )

    return {"status": "success"}


# =============================================================================
# ADMIN FOOD GROUPS & ITEMS MANAGEMENT
# =============================================================================

@router.get("/api/admin/food-groups")
async def list_admin_food_groups(_authorized: bool = Depends(verify_admin_pin)):
    return db_service.get_food_groups()


@router.post("/api/admin/food-groups")
async def create_admin_food_group(payload: FoodGroupCreateRequest, _authorized: bool = Depends(verify_admin_pin)):
    gid = db_service.add_food_group(payload.name)
    backup_service.trigger_backup()
    return {"status": "success", "group_id": gid}


@router.put("/api/admin/food-groups/{group_id}")
async def update_admin_food_group(group_id: str, payload: FoodGroupUpdateRequest, _authorized: bool = Depends(verify_admin_pin)):
    success = db_service.update_food_group(group_id, name=payload.name, display_order=payload.display_order)
    if not success:
        raise HTTPException(status_code=404, detail="Food group not found.")
    backup_service.trigger_backup()
    return {"status": "success"}


@router.delete("/api/admin/food-groups/{group_id}")
async def delete_admin_food_group(group_id: str, _authorized: bool = Depends(verify_admin_pin)):
    try:
        success = db_service.delete_food_group(group_id)
        if not success:
            raise HTTPException(status_code=404, detail="Food group not found.")
        backup_service.trigger_backup()
        return {"status": "success"}
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.post("/api/admin/food-groups/reorder")
async def reorder_admin_food_groups(payload: FoodGroupReorderRequest, _authorized: bool = Depends(verify_admin_pin)):
    db_service.reorder_food_groups(payload.ordered_ids)
    backup_service.trigger_backup()
    return {"status": "success"}


@router.get("/api/admin/food-items")
async def list_admin_food_items(_authorized: bool = Depends(verify_admin_pin)):
    return db_service.get_all_food_items_with_signups()


@router.post("/api/admin/food-items")
async def create_admin_food_item(payload: FoodItemCreateRequest, _authorized: bool = Depends(verify_admin_pin)):
    iid = db_service.add_food_item(name=payload.name, group_id=payload.group_id)
    backup_service.trigger_backup()
    return {"status": "success", "item_id": iid}


@router.put("/api/admin/food-items/{item_id}")
async def update_admin_food_item(item_id: str, payload: FoodItemUpdateRequest, _authorized: bool = Depends(verify_admin_pin)):
    if payload.display_order is not None and payload.signer_name is None and not payload.release_claim:
        success = db_service.update_food_item(item_id, name=payload.name, group_id=payload.group_id, display_order=payload.display_order)
    else:
        success = db_service.update_food_signup_admin(
            item_id=item_id,
            name=payload.name,
            group_id=payload.group_id,
            signer_name=payload.signer_name,
            signer_phone=payload.signer_phone,
            dish_description=payload.dish_description,
            release_claim=payload.release_claim
        )
    if not success:
        raise HTTPException(status_code=404, detail="Food item not found.")
    backup_service.trigger_backup()
    if payload.release_claim:
        db_service.log_activity("food_release", payload.signer_name or "Admin", f"Admin released food slot {item_id}", source="admin")
    elif payload.signer_name:
        db_service.log_activity("food_update", payload.signer_name, f"Admin updated potluck slot {item_id} -> {payload.signer_name}", source="admin")
    return {"status": "success"}


@router.delete("/api/admin/food-items/{item_id}")
async def delete_admin_food_item(item_id: str, force: bool = False, _authorized: bool = Depends(verify_admin_pin)):
    try:
        success = db_service.delete_food_item(item_id, force=force)
        if not success:
            raise HTTPException(status_code=404, detail="Food item not found.")
        backup_service.trigger_backup()
        return {"status": "success"}
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


@router.put("/api/admin/food-serving-note")
async def update_admin_serving_note(payload: FoodServingNoteRequest, _authorized: bool = Depends(verify_admin_pin)):
    db_service.set_app_setting("food_serving_note", payload.text)
    backup_service.trigger_backup()
    return {"status": "success"}


@router.put("/api/admin/food-toggle")
async def update_admin_food_toggle(payload: FoodToggleRequest, _authorized: bool = Depends(verify_admin_pin)):
    db_service.set_app_setting("food_signup_enabled", payload.enabled)
    backup_service.trigger_backup()
    return {"status": "success"}


@router.put("/api/admin/signup-toggle")
async def update_admin_signup_toggle(payload: SignupToggleRequest, _authorized: bool = Depends(verify_admin_pin)):
    db_service.set_app_setting("signup_enabled", payload.enabled)
    backup_service.trigger_backup()
    return {"status": "success", "enabled": payload.enabled}
