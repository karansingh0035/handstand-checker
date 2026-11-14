// src/components/PoseCanvas.jsx
import React from 'react';

export function PoseCanvas({
  videoRef,
  canvasRef,
  containerRef,
  isLive = false,
  children,
  aspectRatio
}) {
  return (
    <div
      ref={containerRef}
      className="canvas-wrapper"
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {children}
      <video
        ref={videoRef}
        id="analysis-video"
        className={`analysis-video ${isLive ? 'live-mode' : 'upload-mode'}`}
        playsInline
        muted
      />
      <canvas ref={canvasRef} id="analysis-canvas" />
    </div>
  );
}
