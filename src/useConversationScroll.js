import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useConversationScroll(changes) {
  const viewport = useRef(null), content = useRef(null), following = useRef(true);
  const frame = useRef(0), lastTop = useRef(0), touchY = useRef(null);
  const [paused, setPaused] = useState(false);
  const follow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = viewport.current;
      if (el && following.current) { el.scrollTop = el.scrollHeight; lastTop.current = el.scrollTop; }
    });
  }, []);
  const resume = useCallback(() => { following.current = true; setPaused(false); follow(); }, [follow]);
  useLayoutEffect(follow, changes);
  useEffect(() => {
    const el = viewport.current;
    function pause() { following.current = false; setPaused(true); cancelAnimationFrame(frame.current); }
    function scroll() {
      const nearEnd = el.scrollHeight - el.clientHeight - el.scrollTop <= 32;
      if (nearEnd) { following.current = true; setPaused(false); }
      else if (el.scrollTop < lastTop.current - 1) pause();
      lastTop.current = el.scrollTop;
    }
    const wheel = e => { if (e.deltaY < 0) pause(); };
    const touchStart = e => { touchY.current = e.touches[0]?.clientY; };
    const touchMove = e => {
      const y = e.touches[0]?.clientY;
      if (touchY.current != null && y > touchY.current + 2) pause();
      touchY.current = y;
    };
    const key = e => { if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) pause(); };
    el.addEventListener('scroll', scroll, {passive:true});
    el.addEventListener('wheel', wheel, {passive:true});
    el.addEventListener('touchstart', touchStart, {passive:true});
    el.addEventListener('touchmove', touchMove, {passive:true});
    el.addEventListener('keydown', key);
    const observer = new ResizeObserver(follow);
    observer.observe(el); observer.observe(content.current);
    const resize = () => {
      document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
      follow();
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    resize();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current);
      el.removeEventListener('scroll', scroll); el.removeEventListener('wheel', wheel);
      el.removeEventListener('touchstart', touchStart); el.removeEventListener('touchmove', touchMove); el.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, [follow]);
  return { viewport, content, paused, resume };
}
