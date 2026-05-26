// Legacy file-upload module. ADR-003 moved uploads out of scope; this
// `src/legacy/` directory should have been deleted but still ships.
// IL-DRIFT: ForbiddenArtifact:legacy-uploader / forbidden.file-glob.src/legacy/**.present
export async function legacyUpload(_path: string): Promise<void> {
  throw new Error('legacy uploader has been retired');
}
