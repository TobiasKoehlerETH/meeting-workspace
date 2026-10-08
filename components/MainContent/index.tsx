'use client';

import React from 'react';

export default function MainContent({ children }: { children: React.ReactNode }) {
  return <main className="ap-main min-w-0 flex-1">{children}</main>;
}
