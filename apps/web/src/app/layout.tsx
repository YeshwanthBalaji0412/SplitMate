import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Split-Smart — Explainable Bill Splitting',
  description:
    'Split bills accurately with item-level allocation, tax/fee modeling, and transparent settlement logic.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
