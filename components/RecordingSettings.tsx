import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import { useConfig } from '@/contexts/ConfigContext';
import type { RecordingPreferences } from '@/services/configService';

const preferencesStore = async () => (await import('@tauri-apps/plugin-store')).Store.load('preferences.json');

export function RecordingSettings() {
  const { setSelectedDevices } = useConfig();
  const [preferences, setPreferences] = useState<RecordingPreferences | null>(null);
  const [reminder, setReminder] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<RecordingPreferences>('get_recording_preferences').then(setPreferences)
      .catch(error => toast.error('Could not load recording settings', { description: String(error) }));
    preferencesStore().then(store => store.get<boolean>('show_recording_notification'))
      .then(value => setReminder(value ?? true)).catch(() => {});
  }, []);

  async function changeDevices(devices: SelectedDevices) {
    if (!preferences) return;
    const next = { ...preferences, preferred_mic_device: devices.micDevice, preferred_system_device: devices.systemDevice };
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: next });
      setPreferences(next);
      setSelectedDevices(devices); // the next recording uses them immediately
    } catch (error) {
      toast.error('Could not save audio devices', { description: String(error) });
    } finally { setSaving(false); }
  }

  async function changeReminder(enabled: boolean) {
    setReminder(enabled);
    try {
      const store = await preferencesStore();
      await store.set('show_recording_notification', enabled);
      await store.save();
    } catch (error) {
      setReminder(!enabled);
      toast.error('Could not save the reminder setting', { description: String(error) });
    }
  }

  if (!preferences) return <p role="status" className="text-sm text-gray-500">Loading…</p>;

  return <div className="space-y-6">
    <section>
      <DeviceSelection disabled={saving} onDeviceChange={changeDevices}
        selectedDevices={{ micDevice: preferences.preferred_mic_device, systemDevice: preferences.preferred_system_device }} />
    </section>
    <section className="flex items-center justify-between gap-4 border-t pt-6">
      <div>
        <h3>Recording reminder</h3>
        <p className="text-sm text-gray-600">Remind me to notify participants.</p>
      </div>
      <Switch aria-label="Recording reminder" checked={reminder} onCheckedChange={changeReminder} />
    </section>
    <section className="space-y-2 border-t pt-6">
      <h3>Saved recordings</h3>
      <p className="break-all text-sm text-gray-600">{preferences.save_folder || 'Default folder'}</p>
      <button type="button" onClick={() => void invoke('open_recordings_folder')}
        className="flex items-center gap-2 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
        <FolderOpen className="h-4 w-4" aria-hidden="true" />Open folder
      </button>
    </section>
  </div>;
}
