import os
import re
from typing import Optional, Generator
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.exceptions import AudioNotFoundError, InvalidByteRangeError


def parse_range_header(range_header: Optional[str], file_size: int) -> tuple[int, int]:
    """Parses standard RFC 206 Range header for byte ranges."""
    start = 0
    end = file_size - 1

    if range_header:
        match = re.match(r"bytes=(\d+)-(\d*)", range_header.strip())
        if match:
            start = int(match.group(1))
            if match.group(2):
                end = int(match.group(2))

    if start >= file_size or end >= file_size or start > end:
        raise InvalidByteRangeError("Requested range not satisfiable", file_size=file_size)

    return start, end


def stream_file_range(
    filepath: str,
    range_header: Optional[str] = None,
    media_type: str = "audio/mpeg",
    chunk_size: int = 65536
) -> StreamingResponse:
    """
    Builds an RFC 206 partial content or 200 OK StreamingResponse for a local file.
    Translates domain errors into standard HTTP responses.
    """
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Audio file not found on server")

    file_size = os.path.getsize(filepath)

    try:
        start, end = parse_range_header(range_header, file_size)
    except InvalidByteRangeError as ex:
        raise HTTPException(
            status_code=416,
            detail="Requested Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{ex.file_size}"}
        )

    content_length = end - start + 1

    def file_iterator() -> Generator[bytes, None, None]:
        with open(filepath, "rb") as f:
            f.seek(start)
            bytes_remaining = content_length
            while bytes_remaining > 0:
                read_len = min(chunk_size, bytes_remaining)
                chunk = f.read(read_len)
                if not chunk:
                    break
                bytes_remaining -= len(chunk)
                yield chunk

    status_code = 206 if range_header else 200
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": media_type,
        "Cache-Control": "public, max-age=3600"
    }

    return StreamingResponse(file_iterator(), status_code=status_code, headers=headers)
