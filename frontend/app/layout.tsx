import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { WebSocketProvider } from '../lib/websocket';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Enterprise Manager',
  description: 'Real-time system monitoring and management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          <WebSocketProvider>
            {children}
          </WebSocketProvider>
        </div>
      </body>
    </html>
  );
}
