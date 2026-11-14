// src/components/PoseCanvas.jsx
import React, { useEffect, useRef } from 'react';

export function PoseCanvas({
  videoRef,
  canvasRef,
  containerRef,
  isLive = false,
  children,
  aspectRatio
}) {
  const localContainerRef = useRef(null);
  const resolvedContainerRef = containerRef || localContainerRef;

  // Auto-resize canvas whenever container is resized or transitions from display: none to flex
  useEffect(() => {
    const container = resolvedContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const targetW = Math.round(width * dpr);
          const targetH = Math.round(height * dpr);
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [canvasRef, resolvedContainerRef]);

  return (
    <div
      ref={resolvedContainerRef}
      className="canvas-wrapper"
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      <video
        ref={videoRef}
        id="analysis-video"
        className={`analysis-video ${isLive ? 'live-mode' : 'upload-mode'}`}
        playsInline
        muted
      />
      <canvas ref={canvasRef} id="analysis-canvas" />
      {children}
    </div>
  );
}
