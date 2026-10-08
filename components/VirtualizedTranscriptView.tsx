'use client';

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TranscriptSegmentData } from '@/types';
import { formatClock } from '@/lib/utils';

interface Props {
  segments: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}

/** Saved transcript with virtualized rows; loads the next page as the end comes into view. */
export function VirtualizedTranscriptView({ segments, hasMore = false, isLoadingMore = false, totalCount = 0, loadedCount = 0, onLoadMore }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: segments.length, getScrollElement: () => scrollRef.current, estimateSize: () => 60, overscan: 10,
  });
  const rows = virtualizer.getVirtualItems();
  const lastRendered = rows.at(-1)?.index ?? -1;

  useEffect(() => {
    if (hasMore && !isLoadingMore && lastRendered >= segments.length - 5) onLoadMore?.();
  }, [lastRendered, hasMore, isLoadingMore, segments.length, onLoadMore]);

  return <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-2">
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {rows.map(row => {
        const segment = segments[row.index];
        return <div key={segment.id} id={`segment-${segment.id}`} data-index={row.index} ref={virtualizer.measureElement}
          className="absolute inset-x-0 top-0 flex gap-2 pb-3" style={{ transform: `translateY(${row.start}px)` }}>
          <span className="mt-1 w-12 shrink-0 text-xs tabular-nums text-gray-400">{formatClock(segment.timestamp)}</span>
          <div className="min-w-0 flex-1">
            {segment.speaker && <p className="mb-1 text-xs font-semibold text-gray-600">{segment.speaker}</p>}
            <p className="leading-relaxed text-gray-800">{segment.text.trim() || '[Silence]'}</p>
          </div>
        </div>;
      })}
    </div>
    {(hasMore || isLoadingMore) && <p role="status" className="py-4 text-center text-sm text-gray-400">
      {isLoadingMore ? 'Loading more…' : `Showing ${loadedCount} of ${totalCount} segments`}
    </p>}
  </div>;
}
