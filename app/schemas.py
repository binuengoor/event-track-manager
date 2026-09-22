import re
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


def validate_phone(phone: Optional[str]) -> bool:
    """Validates that a phone number contains at least 10 digits."""
    if not phone:
        return False
    digits = re.sub(r"\D", "", str(phone))
    return len(digits) >= 10


class LoginRequest(BaseModel):
    pin: str


class StatusUpdateRequest(BaseModel):
    status: str


class PerformanceNotesRequest(BaseModel):
    notes: str = ""


class PerformanceSignupItem(BaseModel):
    performance_type: str = "Solo"
    song_title: Optional[str] = ""
    movie_name: Optional[str] = ""
    partner_name: Optional[str] = None
    partner_age_group: Optional[str] = None
    partner_phone: Optional[str] = ""
    stage_notes: Optional[str] = ""
    is_acoustic: bool = False


class FoodSignupItem(BaseModel):
    item_id: str
    dish_description: Optional[str] = ""


class SignupRequest(BaseModel):
    performer_name: str
    contact_info: Optional[str] = ""
    age_group: Optional[str] = ""
    guardian_name: Optional[str] = ""
    guardian_phone: Optional[str] = ""
    registration_type: Optional[str] = "performer"
    performances: List[PerformanceSignupItem] = []
    food_signup: Optional[FoodSignupItem] = None


class PerformanceUpdateRequest(BaseModel):
    song_title: Optional[str] = None
    movie_name: Optional[str] = None
    partner_name: Optional[str] = None
    partner_age_group: Optional[str] = None
    partner_phone: Optional[str] = None
    performance_type: Optional[str] = None
    stage_notes: Optional[str] = None
    age_group: Optional[str] = None
    guardian_name: Optional[str] = None
    guardian_phone: Optional[str] = None
    contact_info: Optional[str] = None
    is_acoustic: Optional[bool] = None
    track_status: Optional[str] = None


class AdminParticipantUpdateRequest(BaseModel):
    performer_name: Optional[str] = None
    age_group: Optional[str] = None
    guardian_name: Optional[str] = None
    guardian_phone: Optional[str] = None
    contact_info: Optional[str] = None
    phone: Optional[str] = None
    performance_type: Optional[str] = None
    partner_name: Optional[str] = None
    partner_age_group: Optional[str] = None
    partner_phone: Optional[str] = None
    song_title: Optional[str] = None
    movie_name: Optional[str] = None
    sequence_order: Optional[int] = None
    track_status: Optional[str] = None
    performance_status: Optional[str] = None
    stage_notes: Optional[str] = None
    food_item_id: Optional[str] = None


class AddPerformanceRequest(BaseModel):
    performer_name: str
    performance_type: str = "Solo"
    song_title: str = ""
    movie_name: Optional[str] = ""
    partner_name: Optional[str] = ""
    partner_age_group: Optional[str] = None
    partner_phone: Optional[str] = ""
    stage_notes: Optional[str] = ""
    is_acoustic: bool = False


class PerformerRenameRequest(BaseModel):
    old_name: str
    new_name: str


class FoodClaimRequest(BaseModel):
    item_id: str
    signer_name: str
    dish_description: Optional[str] = ""
    signer_phone: Optional[str] = ""


class FoodUpdateRequest(BaseModel):
    item_id: Optional[str] = None
    dish_description: Optional[str] = None


class FoodGroupCreateRequest(BaseModel):
    name: str


class FoodGroupUpdateRequest(BaseModel):
    name: Optional[str] = None
    display_order: Optional[int] = None


class FoodGroupReorderRequest(BaseModel):
    ordered_ids: List[str]


class FoodItemCreateRequest(BaseModel):
    name: str
    group_id: str


class FoodItemUpdateRequest(BaseModel):
    name: Optional[str] = None
    group_id: Optional[str] = None
    display_order: Optional[int] = None
    signer_name: Optional[str] = None
    signer_phone: Optional[str] = None
    dish_description: Optional[str] = None
    release_claim: bool = False


class FoodServingNoteRequest(BaseModel):
    text: str


class FoodToggleRequest(BaseModel):
    enabled: bool


class SignupToggleRequest(BaseModel):
    enabled: bool


class SequenceItem(BaseModel):
    entry_id: str
    sequence_order: int


class ReorderRequest(BaseModel):
    items: List[SequenceItem]
    push_to_sheet: bool = False


class PerformanceEntry(BaseModel):
    entry_id: str
    performer_name: str
    performance_type: str = "Solo"
    partner_name: Optional[str] = None
    contact_info: Optional[str] = None
    song_title: str
    movie_name: Optional[str] = None
    sequence_order: Optional[int] = None
    performance_status: str = "Upcoming"
    track_status: str = "Pending"
    duration: Optional[str] = None
    drive_file_id: Optional[str] = None
    drive_file_name: Optional[str] = None
    last_updated: Optional[str] = None
    row_index: int = 0
    is_song_name_missing: bool = False
    extra_tags: List[str] = []
    stage_notes: Optional[str] = ""
    age_group: Optional[str] = ""
    guardian_name: Optional[str] = ""
    guardian_phone: Optional[str] = ""
    partner_age_group: Optional[str] = ""
    partner_phone: Optional[str] = ""
    created_via: Optional[str] = "sheet"
    media_type: Optional[str] = "audio"
