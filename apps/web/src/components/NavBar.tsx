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
    <nav className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="max-w-6xl mx-auto flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-gray-900">
          <span className="bg-gray-900 text-white px-2 py-0.5 rounded text-sm font-mono">AL</span>
          Agent Ledger
        </Link>
        <div className="flex gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
