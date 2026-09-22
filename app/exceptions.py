"""
Core domain exceptions for Event Track Manager.
Decouples domain services and repositories from HTTP/web framework concepts.
"""

class DomainException(Exception):
    """Base exception for domain-level errors."""
    def __init__(self, message: str, detail: str = ""):
        super().__init__(message)
        self.message = message
        self.detail = detail or message


class AudioError(DomainException):
    """Base exception for audio processing errors."""
    pass


class AudioNotFoundError(AudioError):
    """Raised when an audio file or cache cannot be located."""
    pass


class InvalidByteRangeError(AudioError):
    """Raised when an HTTP Range byte request is invalid or unsatisfiable."""
    def __init__(self, message: str, file_size: int):
        super().__init__(message, f"Requested range not satisfiable for file of size {file_size}")
        self.file_size = file_size


class AudioTranscodeError(AudioError):
    """Raised when audio transcoding fails."""
    pass


class InvalidAudioError(AudioError):
    """Raised when an uploaded audio file is invalid, corrupted, or 0 duration."""
    pass


class FileTooLargeError(AudioError):
    """Raised when an uploaded file exceeds the configured size limit."""
    pass


class PerformanceNotFoundError(DomainException):
    """Raised when a performance entry cannot be found."""
    pass


class UploadDisabledError(DomainException):
    """Raised when uploads are disabled."""
    pass


class MissingSongTitleError(DomainException):
    """Raised when an upload is attempted before specifying song title."""
    pass


class ExternalServiceError(DomainException):
    """Raised when an external service (Drive, Sheets, Downloader) fails."""
    pass


class RegistrationError(DomainException):
    """Raised when registration rules or constraints are violated."""
    pass


class PerformerLimitReachedError(RegistrationError):
    """Raised when a performer exceeds solo or total performance limits."""
    pass


class FoodSignupError(DomainException):
    """Raised for potluck/food catalog errors."""
    pass


class FoodItemUnavailableError(FoodSignupError):
    """Raised when a food item has already been claimed."""
    pass


class FoodGroupNotEmptyError(FoodSignupError):
    """Raised when trying to delete a food group that still has items."""
    pass
