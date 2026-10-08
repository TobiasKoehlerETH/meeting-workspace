import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 75 → "01:15", 3725 → "1:02:05" */
export function formatClock(seconds: number | null | undefined) {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const pad = (value: number) => String(value).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export type SettingsTab = 'general' | 'recording' | 'transcription' | 'summary' | 'beta';

/** The sidebar owns the settings dialog; the tray calls the same global. */
export function openSettings(tab?: SettingsTab) {
  (window as Window & { openSettings?: (tab?: SettingsTab) => void }).openSettings?.(tab);
}

/**
 * Detects if an error message indicates that Ollama is not installed or not running
 * @param errorMessage - The error message to check
 * @returns true if the error indicates Ollama is not installed/running
 */
export function isOllamaNotInstalledError(errorMessage: string): boolean {
  if (!errorMessage) return false;

  const lowerError = errorMessage.toLowerCase();

  // Check for common patterns that indicate Ollama is not installed or not running
  const patterns = [
    'cannot connect',
    'connection refused',
    'cli not found',
    'not in path',
    'ollama cli not found',
    'not found or not in path',
    'please check if the server is running',
    'please check if the ollama server is running',
    'econnrefused',
  ];

  return patterns.some(pattern => lowerError.includes(pattern));
}
