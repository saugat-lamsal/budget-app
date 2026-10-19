import { motion } from 'motion/react';
import { TAB_LABELS, TABS, pathOf, type Tab } from '../app/routes.js';
import { Icon } from './Icon.js';
import { EASE, QUICK_S } from './motion.js';

// The bottom tab bar: Home, Buckets, Review, Trends, Settings. Each tab is a real
// link to its own address. Review shows how many items wait.
export function TabBar({ current, onGo, waitingInReview }: { readonly current: Tab; readonly onGo: (tab: Tab) => void; readonly waitingInReview: number }) {
  return (
    <nav className="tabbar" aria-label="Main">
      <ul className="tabbar__list">
        {TABS.map((tab) => {
          const badge = tab === 'review' && waitingInReview > 0 ? waitingInReview : null;
          return (
            <li key={tab} className="tabbar__item">
              <a
                className="tab"
                href={pathOf(tab)}
                aria-current={tab === current ? 'page' : undefined}
                data-testid={`tab-${tab}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onGo(tab);
                }}
              >
                {tab === current && <motion.span layoutId="tab-line" className="tab__line" aria-hidden="true" transition={{ duration: QUICK_S, ease: EASE }} />}
                <span className="tab__icon">
                  <Icon name={tab} size={24} />
                  {badge !== null && (
                    <span className="badge" aria-hidden="true" data-testid="review-badge">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                <span>
                  {TAB_LABELS[tab]}
                  {badge !== null && <span className="sr-only">, {badge} waiting</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
