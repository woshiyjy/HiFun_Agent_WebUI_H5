import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useConversationScroll(changes) {
  const viewport = useRef(null), content = useRef(null), following = useRef(true);
  const frame = useRef(0), touchY = useRef(null);
  const [paused, setPaused] = useState(false);
  const follow = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = viewport.current;
      if (el && following.current) {
        const root = document.scrollingElement || document.documentElement;
        window.scrollTo({ top: root.scrollHeight, behavior: 'auto' });
      }
    });
  }, []);
  const resume = useCallback(() => { following.current = true; setPaused(false); follow(); }, [follow]);
  useLayoutEffect(follow, changes);
  useEffect(() => {
    if (!viewport.current) return;
    function pause() { following.current = false; setPaused(true); cancelAnimationFrame(frame.current); }
    function scroll() {
      const root = document.scrollingElement || document.documentElement;
      const nearEnd = root.scrollHeight - window.scrollY - window.innerHeight <= 32;
      if (nearEnd) { following.current = true; setPaused(false); }
      else pause();
    }
    const wheel = e => {
      const root = document.scrollingElement || document.documentElement;
      if (e.deltaY < 0 && root.scrollHeight > window.innerHeight) pause();
    };
    const touchStart = e => { touchY.current = e.touches[0]?.clientY; };
    const touchMove = e => {
      const y = e.touches[0]?.clientY;
      if (touchY.current != null && y > touchY.current + 2) pause();
      touchY.current = y;
    };
    const key = e => {
      if (e.target instanceof HTMLElement && e.target.closest('textarea,input,[contenteditable="true"]')) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) pause();
    };
    window.addEventListener('scroll', scroll, {passive:true});
    window.addEventListener('wheel', wheel, {passive:true, capture:true});
    document.addEventListener('touchstart', touchStart, {passive:true});
    document.addEventListener('touchmove', touchMove, {passive:true});
    window.addEventListener('keydown', key);
    const observer = new ResizeObserver(follow);
    if (content.current) observer.observe(content.current);
    const resize = () => follow();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    follow();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current);
      window.removeEventListener('scroll', scroll); window.removeEventListener('wheel', wheel, {capture:true});
      document.removeEventListener('touchstart', touchStart); document.removeEventListener('touchmove', touchMove); window.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [follow]);
  return { viewport, content, paused, resume };
}
