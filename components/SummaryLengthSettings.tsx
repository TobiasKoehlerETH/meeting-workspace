'use client';

import { useEffect, useState } from 'react';
import { getSummaryLines, DEFAULT_SUMMARY_LINES, MAX_SUMMARY_LINES } from '@/lib/summary-length';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function SummaryLengthSettings() {
  const [lines, setLines] = useState(String(DEFAULT_SUMMARY_LINES));
  useEffect(() => { setLines(String(getSummaryLines())); }, []);
  const count = Number(lines);
  const valid = Number.isInteger(count) && count >= 1 && count <= MAX_SUMMARY_LINES;
  return <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-6">
    <Label htmlFor="summary-lines">Summary lines</Label>
    <Input id="summary-lines" type="number" min={1} max={MAX_SUMMARY_LINES} step={1}
      value={lines} aria-invalid={!valid} aria-describedby="summary-lines-help"
      onChange={event => {
        const value = event.target.value;
        setLines(value);
        const number = Number(value);
        if (Number.isInteger(number) && number >= 1 && number <= MAX_SUMMARY_LINES) {
          localStorage.setItem('summaryLines', String(number));
        }
      }} />
    <p id="summary-lines-help" className="text-sm text-gray-600">
      {valid ? '1–50 bullets, as needed.' : 'Enter a whole number from 1 to 50.'}
    </p>
  </div>;
}
