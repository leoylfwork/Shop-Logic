import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CK-Flow 2.0 - Shop Management System',
  description: 'Vehicle-centric shop management system with AI diagnostics',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
