import os
import logging
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from app.config import settings
from app.services.db_service import db_service

logger = logging.getLogger("stage-service")


class StageService:
    @staticmethod
    def get_gallery_images() -> List[str]:
        """Scans the configured gallery directory and returns web-accessible URLs."""
        gallery_dir = settings.storage.gallery_dir
        if not gallery_dir or not os.path.isdir(gallery_dir):
            return []

        valid_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
        images = []
        try:
            for fname in sorted(os.listdir(gallery_dir)):
                if fname.startswith("."):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                if ext in valid_exts:
                    safe_name = urllib.parse.quote(fname)
                    images.append(f"/data/gallery/{safe_name}")
        except Exception as ex:
            logger.warning("Error scanning gallery directory %s: %s", gallery_dir, ex)
        return images

    @staticmethod
    def is_eligible_for_stage(p) -> bool:
        """Determines if a performance is ready to be cued backstage or onstage."""
        ptype = (getattr(p, "performance_type", None) or "").strip().lower()
        if "no-track" in ptype or "notrack" in ptype or "no track" in ptype:
            return True
        if "acoustic" in ptype or "live" in ptype:
            return True
        if "group" in ptype and "karaoke" not in ptype:
            return True
        # Backing track uploaded or present in active Drive
        track_status = getattr(p, "track_status", None)
        drive_file_id = getattr(p, "drive_file_id", None)
        if track_status == "Uploaded" or bool(drive_file_id):
            return True
        return False

    def get_live_status(self) -> Dict[str, Any]:
        """Calculates stage breakdown (now performing, up next, upcoming, done, hold) for /live."""
        from app.services.google_service import google_service

        last_sync = db_service.get_last_sync_time()

        # Background sync for live view if cache is stale (> 30 seconds)
        if not google_service.mock_mode:
            should_sync = False
            if not last_sync:
                should_sync = True
            else:
                try:
                    dt = datetime.fromisoformat(last_sync)
                    diff = (datetime.now(timezone.utc) - dt).total_seconds()
                    if diff > 30:
                        should_sync = True
                except Exception:
                    pass

            if should_sync:
                try:
                    google_service.get_performances(force_sync=True)
                    last_sync = db_service.get_last_sync_time()
                except Exception as ex:
                    logger.warning("Background live sync failed: %s", ex)

        queue = google_service.get_stage_queue()
        now_performing = None
        up_next = []
        upcoming = []
        performed = []
        on_hold = []

        active_id = db_service.get_active_entry_id()
        if active_id:
            now_performing = next((p for p in queue if p.entry_id == active_id), None)

        now_id = now_performing.entry_id if now_performing else None

        for p in queue:
            if p.entry_id == now_id:
                continue
            if p.performance_status in ("Performed", "Done"):
                performed.append(p)
            elif p.performance_status in ("On Hold", "Skipped"):
                on_hold.append(p)
            else:
                if self.is_eligible_for_stage(p) and len(up_next) < 2:
                    up_next.append(p)
                else:
                    upcoming.append(p)

        # Multi-tier sorting for upcoming performances based on LIVE_ORDER_BY
        def get_sort_key(p):
            strategy_fields = [f.strip().lower() for f in settings.live_order_by.split(",") if f.strip()]
            key = []
            for f in strategy_fields:
                if f in ("readiness", "ready", "download_status", "no_track_status"):
                    key.append(0 if self.is_eligible_for_stage(p) else 1)
                elif f in ("age_group", "age"):
                    ag = (p.age_group or "").lower()
                    if not ag:
                        for t in (p.extra_tags or []):
                            if "junior" in t.lower():
                                ag = "junior"
                                break
                            elif "senior" in t.lower():
                                ag = "senior"
                                break
                    if "junior" in ag:
                        key.append(0)
                    elif "senior" in ag:
                        key.append(1)
                    else:
                        key.append(2)
                elif f in ("sequence", "sequence_order", "seq"):
                    seq = p.sequence_order if p.sequence_order is not None and p.sequence_order > 0 else 9999
                    key.append(seq)
                elif f in ("performance_type", "type"):
                    pt = (p.performance_type or "").lower()
                    if "solo" in pt:
                        key.append(0)
                    elif "duet" in pt:
                        key.append(1)
                    elif "group" in pt:
                        key.append(2)
                    else:
                        key.append(3)
            seq = p.sequence_order if p.sequence_order is not None and p.sequence_order > 0 else 9999
            key.append(seq)
            key.append(getattr(p, "row_index", 0))
            return tuple(key)

        upcoming.sort(key=get_sort_key)

        return {
            "event_name": settings.event.name,
            "event_subtitle": settings.event.subtitle,
            "event_start_time": settings.event.start_time,
            "event_start_time_iso": settings.event.start_time_iso,
            "now_performing": now_performing,
            "up_next": up_next,
            "upcoming": upcoming,
            "performed": performed,
            "on_hold": on_hold,
            "total_count": len(queue),
            "completed_count": len(performed),
            "last_synced_at": last_sync,
            "is_dirty": db_service.is_sequence_dirty(),
            "active_entry_id": active_id,
            "gallery_images": self.get_gallery_images()
        }


stage_service = StageService()
