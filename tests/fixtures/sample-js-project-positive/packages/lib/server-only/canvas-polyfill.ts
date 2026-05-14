
// Top-level module polyfill: patch a third-party class to satisfy a runtime interface check
declare const OffscreenPath2D: { prototype: { toString(): string } };

OffscreenPath2D.prototype.toString = () => '[object Path2D]';
