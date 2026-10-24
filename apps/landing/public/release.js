// Only populate from the exact published, natively verified release receipt.
// URL: https://github.com/aflekkas/athens-racing/releases/download/<tag>/<file>
window.ATHENS_RELEASE = {
  version: null,
  artifacts: {
    mac: { url: null, sha256: null, bytes: null, nativeVerified: false, file: 'DMG', installNote: null },
    win: { url: null, sha256: null, bytes: null, nativeVerified: false, file: 'installer (.exe)', installNote: null },
    linux: { url: null, sha256: null, bytes: null, nativeVerified: false, file: 'AppImage', installNote: null }
  }
};
