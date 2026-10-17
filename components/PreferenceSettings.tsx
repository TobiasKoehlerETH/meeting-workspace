"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { Switch } from "./ui/switch"
import { useConfig } from "@/contexts/ConfigContext"
import { LaunchSettings } from './LaunchSettings';

export function PreferenceSettings() {
  const { notificationSettings, loadPreferences, updateNotificationSettings } = useConfig();
  useEffect(() => { loadPreferences(); }, [loadPreferences]);

  const preferences = notificationSettings?.notification_preferences;
  const enabled = preferences ? preferences.show_recording_started && preferences.show_recording_stopped : true;
  const toggle = (on: boolean) => {
    if (!notificationSettings || !preferences) return;
    updateNotificationSettings({ ...notificationSettings,
      notification_preferences: { ...preferences, show_recording_started: on, show_recording_stopped: on } })
      .catch(error => toast.error('Could not save notifications', { description: String(error) }));
  };

  return (
    <div className="space-y-6">
      <LaunchSettings />
      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-6">
        <div>
          <h3>Recording notifications</h3>
        </div>
        <Switch aria-label="Recording notifications" checked={enabled} disabled={!preferences} onCheckedChange={toggle} />
      </div>
    </div>
  )
}
