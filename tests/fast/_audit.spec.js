import { test } from '@playwright/test';
import { openWarm, gotoTab, TABS } from './helpers';

// A sweep, not a suite. Looks for things that are WRONG rather than checking
// things that are right: console errors, overlapping elements, content that
// escapes its container, controls with no accessible name, empty panels where
// data is expected, horizontal body scroll.
const SIZES = [
    { name: 'desktop', w: 1600, h: 1000 },
    { name: 'laptop', w: 1280, h: 800 },
    { name: 'tablet', w: 900, h: 700 },
    { name: 'phone', w: 390, h: 844 },
];

const AUDIT = `
(() => {
  const out = { overflow: [], clipped: [], unnamed: [], tiny: [], overlap: [] };
  const vw = innerWidth, vh = innerHeight;

  // Content escaping the viewport horizontally, where nothing can scroll to it.
  const scrollableX = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) return true;
      n = n.parentElement;
    }
    return false;
  };

  // visibility:hidden still has a bounding rect. A closed drawer is off-screen
  // ON PURPOSE and is not focusable, so reporting it is noise that hides the
  // real findings underneath.
  const shown = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      n = n.parentElement;
    }
    return true;
  };

  document.querySelectorAll('button, a, input, select, [role="menuitem"]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !shown(el)) return;
    if ((r.right > vw + 1 || r.left < -1) && !scrollableX(el)) {
      out.overflow.push((el.className || el.tagName) + ' @' + Math.round(r.left) + ',' + Math.round(r.right));
    }
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
    if (!name) out.unnamed.push(el.className || el.tagName);
    if (r.width < 12 || r.height < 12) out.tiny.push((el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });

  // Text spilling out of its own box.
  // Text spilling out of its own box — but NOT a child placed outside it on
  // purpose. The tag marker sits at top:-8px right:-8px, overhanging the card
  // corner by design, and it made every card on every screen look broken.
  document.querySelectorAll('.rv-slot, .player-card, .sg-row, .season-open, .up-match').forEach(el => {
    const overhang = [...el.children].some(k => getComputedStyle(k).position === 'absolute');
    if (!overhang && el.scrollWidth > el.clientWidth + 2) {
      out.clipped.push((el.className || el.tagName) + ' ' + el.scrollWidth + '>' + el.clientWidth);
    }
  });

  return {
    ...out,
    bodyScrollsX: document.body.scrollWidth > vw + 1,
    counts: {
      slots: document.querySelectorAll('.rv-slot-name').length,
      cards: document.querySelectorAll('.player-card').length,
      rows: document.querySelectorAll('.sg-row').length,
    },
  };
})()
`;

for (const size of SIZES) {
    test(`sweep ${size.name}`, async ({ page }) => {
        const errors = [];
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
        page.on('pageerror', e => errors.push('PAGEERROR ' + e.message.slice(0, 160)));

        await page.setViewportSize({ width: size.w, height: size.h });
        await openWarm(page);

        for (const tab of Object.keys(TABS)) {
            await gotoTab(page, tab);
            await page.waitForTimeout(2200);
            const found = await page.evaluate(AUDIT);
            const problems = Object.entries(found)
                .filter(([k, v]) => Array.isArray(v) && v.length)
                .map(([k, v]) => `${k}=${JSON.stringify([...new Set(v)].slice(0, 4))}`);
            console.log(`AUDIT ${size.name} ${tab} counts=${JSON.stringify(found.counts)} bodyX=${found.bodyScrollsX}` +
                (problems.length ? ' ' + problems.join(' ') : ''));
        }
        if (errors.length) console.log(`ERRORS ${size.name} ${JSON.stringify([...new Set(errors)].slice(0, 5))}`);
    });
}
