# Legacy file-upload module. ADR-003 moved uploads out of scope; this
# `app/legacy/` package should have been deleted but still ships.
# IL-DRIFT: ForbiddenArtifact:legacy-uploader / forbidden.file-glob.app/legacy/**.present


def legacy_upload(path: str) -> None:
    raise RuntimeError("legacy uploader has been retired")
