import { invoke } from '@tauri-apps/api/core';

interface AudioDevice { name: string; device_type: 'Input' | 'Output' }
let pending: Promise<AudioDevice[]> | null = null;

/** Share concurrent UI checks, but always refresh once the request has completed. */
export function getAudioDevices(): Promise<AudioDevice[]> {
  if (!pending) {
    pending = invoke<AudioDevice[]>('get_audio_devices').finally(() => { pending = null; });
  }
  return pending;
}
