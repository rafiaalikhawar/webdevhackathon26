import React, { useEffect, useRef } from 'react';
import './hero-background.css';

const VIDEO_URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4';

export default function HeroBackground({ active = true }) {
  const videoRef = useRef();

  useEffect(() => {
    const video = videoRef.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = true;
    let disposed = false;

    function syncPlayback() {
      if (disposed) return;
      if (!active || motion.matches || document.hidden || !inView) {
        video.pause();
      } else if (video.paused) {
        const playback = video.play();
        playback?.catch(() => {});
      }
    }

    function showFrame() {
      video.classList.add('ready');
      syncPlayback();
    }

    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncPlayback();
    });
    observer.observe(video);
    video.addEventListener('loadeddata', showFrame);
    document.addEventListener('visibilitychange', syncPlayback);
    motion.addEventListener('change', syncPlayback);
    if (video.readyState >= 2) showFrame();
    syncPlayback();

    return () => {
      disposed = true;
      video.pause();
      observer.disconnect();
      video.removeEventListener('loadeddata', showFrame);
      document.removeEventListener('visibilitychange', syncPlayback);
      motion.removeEventListener('change', syncPlayback);
    };
  }, [active]);

  return <div className="hero-video-background" aria-hidden="true">
    <video ref={videoRef} className="hero-background-video" muted loop playsInline preload="auto" tabIndex={-1} disablePictureInPicture>
      <source src={VIDEO_URL} type="video/mp4" />
    </video>
    <div className="hero-video-shade" />
  </div>;
}
