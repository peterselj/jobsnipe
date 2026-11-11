import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Guided tour over the demo (made-up companies, nothing saved), in the same style as JobBoard's.
 * Each step dims the page, cuts a "spotlight" around one part of the screen (found by a CSS
 * selector, usually a data-tour="…" attribute) and shows a short card next to it.
 *
 * Three kinds of step:
 *  - read: the spotlight is look-only; the Next button moves on.
 *  - do:   (`done`) the spotlight can be clicked, and the tour moves on by itself once the person
 *          has done the thing ("YOUR TURN").
 *  - a step with no target is a card in the middle of the screen (welcome, finish).
 */

type View = 'matches' | 'settings';

interface Ctx {
  /** Roles marked ★ Interested right now, and how many there were when the step began. */
  interested: number;
  baseline: number;
}

interface Step {
  id: string;
  /** CSS selector for the spotlight (alternatives in order of preference); the first match on screen is used. None = centred card. */
  target?: string;
  /** Which screen this step lives on (the tour switches to it). */
  view: View;
  title: string;
  body: ReactNode;
  done?: (ctx: Ctx) => boolean;
  next?: string;
}

const b = (t: string) => <b className="font-bold">{t}</b>;
const selected = (tab: string) => !!document.querySelector(`[data-tour="tab-${tab}"][aria-selected="true"]`);
const FIRST_ROLE = '[data-tour="roles"] article, [data-tour="roles"]';

const STEPS: Step[] = [
  {
    id: 'welcome',
    view: 'matches',
    title: 'Welcome to JobSnipe',
    body: <>This takes about two minutes. JobSnipe watches the companies you'd love to work at and tells you, within the hour, when a role that fits is posted. You're looking at made-up companies, so click freely: nothing is saved.</>,
    next: 'Show me',
  },
  {
    id: 'companies',
    view: 'matches',
    target: '[data-tour="companies"]',
    title: 'Your list of companies',
    body: <>These are the companies you chose. JobSnipe reads each one's own job board {b('every hour')}. To add one, paste a link to its careers page. A red dot means a board stopped answering, and you get an email if it stays that way.</>,
  },
  {
    id: 'inbox',
    view: 'matches',
    target: FIRST_ROLE,
    title: 'A new role that fits',
    body: <>When a role passes your filters it lands here, in your {b('Inbox')}, and you get one email about it. Each card shows the place, the pay when the posting lists it, and when it went public.</>,
  },
  {
    id: 'decide',
    view: 'matches',
    target: FIRST_ROLE,
    title: 'Decide on it',
    body: <>Every role gets one of three answers: {b('★ Interested')}, {b('Not for me')} (with a reason, if you like) or {b('Archive')}. Whatever you decide, it never comes back to your inbox. Try it: click {b('★ Interested')}.</>,
    done: (c) => c.interested > c.baseline,
  },
  {
    id: 'tab-interested',
    view: 'matches',
    target: '[data-tour="tab-interested"]',
    title: 'It moved',
    body: <>The role left your inbox. Click the {b('★ Interested')} tab to see it.</>,
    done: () => selected('interested'),
  },
  {
    id: 'interested',
    view: 'matches',
    target: FIRST_ROLE,
    title: 'Roles you’re going after',
    body: <>These wait here while you work on them. {b('Tailor resume')} copies the posting and hands it to ResumeMachine, which tailors your resume in your own AI assistant. {b('Archive →')} puts a role away once you've applied.</>,
  },
  {
    id: 'tab-near',
    view: 'matches',
    target: '[data-tour="tab-near"]',
    title: 'What your filters are hiding',
    body: <>Filters can be too strict without you knowing. Click {b('Near misses')}.</>,
    done: () => selected('near'),
  },
  {
    id: 'near',
    view: 'matches',
    target: FIRST_ROLE,
    title: 'Near misses',
    body: <>These are in your job family but failed {b('exactly one')} filter: the pay was a little low, the place was off, the posting was old. Each says which. If one is worth it anyway, star it, and you'll see what that filter is costing you.</>,
  },
  {
    id: 'tab-discover',
    view: 'matches',
    target: '[data-tour="tab-discover"]',
    title: 'Beyond your list',
    body: <>What about companies you haven't heard of? Click {b('Discover')}.</>,
    done: () => selected('discover'),
  },
  {
    id: 'discover',
    view: 'matches',
    target: FIRST_ROLE,
    title: 'Discover',
    body: <>Roles that pass all your filters at companies {b('not')} on your list, found on venture-capital job boards and in your own job-alert emails (LinkedIn, Indeed and others). These come as a digest, daily or weekly, never one email each. Like a company? {b('+ Watch company')} adds it to your list.</>,
  },
  {
    id: 'add-role',
    view: 'matches',
    target: '[data-tour="add-role"]',
    title: 'Roles you find yourself',
    body: <>Spotted a job on LinkedIn, or got one from a friend? {b('＋ Add role')} takes any job link and keeps it with the rest, so everything you're considering is in one place.</>,
  },
  {
    id: 'filters',
    view: 'settings',
    target: '[data-tour="filters"]',
    title: 'Your filters decide everything',
    body: <>This is {b('Settings')}. Job titles come first: a role must contain one of these phrases. Below are where you'd work, minimum pay, seniority and how old a posting can be. Saving re-checks every board right away.</>,
  },
  {
    id: 'suggestions',
    view: 'settings',
    target: '[data-tour="suggestions"]',
    title: 'Suggestions, never surprises',
    body: <>JobSnipe notices patterns in what you star and pass on, and offers changes like this one. It {b('never')} changes a filter by itself: each suggestion shows the roles it's based on, and nothing happens until you accept.</>,
  },
  {
    id: 'finish',
    view: 'matches',
    title: 'That’s the loop',
    body: <>Pick your companies, set your filters, and decide on what arrives. Everything here was made up. Keep clicking around, or start your own: it takes an email address, then your job titles and a few companies.</>,
  },
];

const PAD = 6;
const CARD_W = 340;
const DIM = 'rgba(15,26,21,.62)';

interface Box { top: number; left: number; width: number; height: number }

/** The first element matching the selector that's actually on the page. */
function find(sel: string): Element | null {
  // Alternatives (comma-separated) are tried in the order written, not page order.
  for (const one of sel.split(', ')) {
    for (const el of document.querySelectorAll(one)) {
      const q = el.getBoundingClientRect();
      if (q.width || q.height) return el;
    }
  }
  return null;
}

function boxOf(el: Element): Box {
  const q = el.getBoundingClientRect();
  return { top: Math.round(q.top), left: Math.round(q.left), width: Math.round(q.width), height: Math.round(q.height) };
}

export default function Tour({ view, setView, interested, exitLabel, onExit, onEnd }: {
  view: View;
  setView: (v: View) => void;
  /** How many roles are marked ★ Interested, so "do" steps know when it's happened. */
  interested: number;
  /** The finish step's main button: "Sign up" for a visitor, "Back to my account" for someone signed in. */
  exitLabel: string;
  onExit: () => void;
  onEnd: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const ctx = useRef<Ctx>({ interested, baseline: interested });
  ctx.current.interested = interested;

  const next = () => (last ? onEnd() : setIndex(index + 1));

  // On entering a step: switch screens if needed, and note where things stood.
  useEffect(() => {
    if (step.view !== view) setView(step.view);
    ctx.current.baseline = ctx.current.interested;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Every frame: follow the spotlight target (the page scrolls and re-lays-out under it), bring it
  // into view once, and move on when a "do" step is done.
  useEffect(() => {
    let raf = 0;
    let scrolled = false;
    const tick = () => {
      if (step.done?.(ctx.current)) {
        next();
        return;
      }
      const el = step.target ? find(step.target) : null;
      if (el && !scrolled) {
        scrolled = true;
        const q = el.getBoundingClientRect();
        // Leave room for the card under or over the spotlight.
        // (Tabs can also be off to the side of their strip on a phone.)
        if (q.top < 70 || q.bottom > window.innerHeight - 40 || q.left < 8 || q.right > window.innerWidth - 8) {
          el.scrollIntoView({ block: q.height > window.innerHeight * 0.6 ? 'start' : 'center', inline: 'center' });
        }
      }
      const m = el ? boxOf(el) : null;
      setBox((prev) => (prev && m && prev.top === m.top && prev.left === m.left && prev.width === m.width && prev.height === m.height ? prev : m));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [index, box]);

  // Esc leaves the tour.
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onEnd();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onEnd]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - 24);
  const hole = box && { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };

  // Card position: under the spotlight where there's room, else beside or above it, else tucked
  // inside its bottom corner.
  let cardStyle: CSSProperties;
  if (!hole) {
    cardStyle = { top: Math.max(12, (vh - cardH) / 2), left: Math.max(12, (vw - cardW) / 2) };
  } else {
    const gap = 14;
    const room = {
      bottom: vh - (hole.top + hole.height) - gap,
      right: vw - (hole.left + hole.width) - gap,
      left: hole.left - gap,
      top: hole.top - gap,
    };
    const clampX = (x: number) => Math.min(Math.max(12, x), vw - cardW - 12);
    const clampY = (y: number) => Math.min(Math.max(12, y), vh - cardH - 12);
    if (room.bottom >= cardH + 12) cardStyle = { top: hole.top + hole.height + gap, left: clampX(hole.left) };
    else if (room.top >= cardH + 12) cardStyle = { top: hole.top - gap - cardH, left: clampX(hole.left) };
    else if (room.left >= cardW + 12) cardStyle = { top: clampY(hole.top), left: hole.left - gap - cardW };
    else if (room.right >= cardW + 12) cardStyle = { top: clampY(hole.top), left: hole.left + hole.width + gap };
    else cardStyle = { top: clampY(vh - cardH - 20), left: clampX(hole.left + hole.width - cardW - 20) };
  }

  const dim: CSSProperties = { position: 'fixed', background: DIM, zIndex: 80 };

  return (
    <div role="dialog" aria-label="Guided tour">
      {hole ? (
        <>
          {/* four dim panels around the spotlight */}
          <div style={{ ...dim, top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div style={{ ...dim, top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div style={{ ...dim, top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div style={{ ...dim, top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {/* look-only steps: an invisible shield so the spotlight can't be clicked */}
          {!step.done && <div style={{ position: 'fixed', zIndex: 80, ...hole }} />}
          <div style={{ position: 'fixed', zIndex: 81, pointerEvents: 'none', ...hole, borderRadius: 10, boxShadow: '0 0 0 2px #fff, 0 0 0 5px #d9a441' }} />
        </>
      ) : (
        <div style={{ ...dim, inset: 0 }} />
      )}

      <div
        ref={cardRef}
        data-tour-card={step.id}
        className="fixed z-[82] rounded-xl bg-white px-[18px] pb-3.5 pt-4 text-ink shadow-[0_18px_50px_rgba(0,0,0,.35)]"
        style={{ width: cardW, ...cardStyle }}
      >
        <div className="font-mono text-[10.5px] tracking-[.04em] text-muted">
          {index === 0 ? 'GUIDED TOUR' : `STEP ${index + 1} OF ${STEPS.length}`}
          {step.done && <span className="ml-2 text-gold">YOUR TURN</span>}
        </div>
        <div className="mb-1.5 mt-1 text-[17px] font-extrabold tracking-tight">{step.title}</div>
        <div className="text-[13.5px] leading-normal text-ink-soft">{step.body}</div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          {!last && <button className="text-xs text-muted hover:text-ink-soft" onClick={onEnd}>Skip tour</button>}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {last ? (
              <>
                <button className="rounded-md border border-forest bg-white px-3 py-[7px] text-[13px] font-semibold text-forest" onClick={onEnd}>Keep exploring</button>
                <button className="rounded-md bg-forest px-3.5 py-2 text-[13px] font-semibold text-white" onClick={onExit}>{exitLabel}</button>
              </>
            ) : step.done ? (
              <button className="text-xs text-muted hover:text-ink-soft" onClick={next}>Skip this step</button>
            ) : (
              <button className="rounded-md bg-forest px-3.5 py-2 text-[13px] font-semibold text-white" onClick={next}>{step.next ?? 'Next'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
