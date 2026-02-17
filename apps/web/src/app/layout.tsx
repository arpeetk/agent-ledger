import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Ledger',
  description: 'Policy-gated tool execution for AI agents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-6">
            <a href="/" className="font-bold text-lg text-gray-900">
              Agent Ledger
            </a>
            <a href="/" className="text-sm text-gray-600 hover:text-gray-900">
              Timeline
            </a>
            <a href="/approvals" className="text-sm text-gray-600 hover:text-gray-900">
              Approvals
            </a>
          </div>
        </nav>
        <main className="max-w-6xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
