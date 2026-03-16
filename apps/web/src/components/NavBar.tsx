'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Timeline' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/stats', label: 'Stats' },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-neutral-200 px-8 h-12 flex items-center">
      <div className="max-w-5xl mx-auto w-full flex items-center gap-4">
        <Link href="/" className="font-semibold text-sm text-neutral-900">
          Agent Ledger
        </Link>
        <div className="w-px h-5 bg-neutral-200" />
        <div className="flex gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'text-neutral-900 font-medium'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {item.label}
                {isActive && (
                  <span className="absolute bottom-[-0.6875rem] left-3 right-3 h-0.5 bg-neutral-900 rounded-full" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
