import logging
from app.events.bus import event_bus, Event
from app.services.db_service import db_service
from app.services.audio_service import audio_service
from app.services.backup_service import backup_service

logger = logging.getLogger("event-listeners")


def on_data_mutated(event: Event):
    """Triggers debounced Google Sheets backup when data is mutated."""
    try:
        backup_service.trigger_backup()
    except Exception as ex:
        logger.warning("Failed to trigger debounced backup on %s: %s", event.name, ex)


def on_activity_logged(event: Event):
    """Records audit activity entry in SQLite."""
    try:
        db_service.audit_repo.log_activity(
            action_type=event.data.get("action_type", "system"),
            performer_name=event.data.get("performer_name", "System"),
            summary=event.data.get("summary", ""),
            entry_id=event.data.get("entry_id", ""),
            details=event.data.get("details", ""),
            source=event.data.get("source", "event")
        )
    except Exception as ex:
        logger.warning("Failed to record activity log on %s: %s", event.name, ex)


def on_performer_renamed(event: Event):
    """Cascades performer rename to food signups without cross-repo coupling."""
    old_name = event.data.get("old_name")
    new_name = event.data.get("new_name")
    if not old_name or not new_name:
        return
    try:
        db_service.food_repo.rename_signer(old_name, new_name)
    except Exception as ex:
        logger.warning("Failed to cascade performer rename to food signups: %s", ex)


def on_food_signer_renamed(event: Event):
    """Cascades food signer rename to performances if old signer was a performer and new signer is not."""
    old_name = event.data.get("old_signer")
    new_name = event.data.get("new_signer")
    if not old_name or not new_name:
        return
    try:
        counts_new = db_service.performance_repo.count_performances_for_performer(new_name)
        if counts_new["total"] == 0:
            counts_old = db_service.performance_repo.count_performances_for_performer(old_name)
            if counts_old["total"] > 0:
                db_service.performance_repo.rename_performer(old_name, new_name)
    except Exception as ex:
        logger.warning("Failed to cascade food signer rename to performances: %s", ex)


def on_performance_deleted(event: Event):
    """Purges audio cache when a performance entry is deleted."""
    entry_id = event.data.get("entry_id")
    if not entry_id:
        return
    try:
        audio_service.purge_cache(entry_id)
    except Exception as ex:
        logger.warning("Failed to purge audio cache for deleted performance %s: %s", entry_id, ex)


def register_default_listeners():
    """Binds standard application event listeners to the EventBus."""
    event_bus.subscribe("data.mutated", on_data_mutated)
    event_bus.subscribe("activity.logged", on_activity_logged)
    event_bus.subscribe("performer.renamed", on_performer_renamed)
    event_bus.subscribe("food_signer.renamed", on_food_signer_renamed)
    event_bus.subscribe("performance.deleted", on_performance_deleted)
    logger.info("Registered default domain event listeners.")
