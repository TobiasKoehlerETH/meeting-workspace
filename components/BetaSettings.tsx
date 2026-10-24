"use client"

import { Switch } from "./ui/switch"
import { FlaskConical } from "lucide-react"
import { useConfig } from "@/contexts/ConfigContext"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe'];

  return (
    <div className="space-y-3">
      {/* Dynamic Feature Toggles - Automatically renders all features */}
      {featureOrder.map((featureKey) => (
        <div
          key={featureKey}
          className="bg-white rounded-lg border border-gray-200 p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex flex-1 items-center gap-2" title={BETA_FEATURE_DESCRIPTIONS[featureKey]}>
              <FlaskConical className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <h3>{BETA_FEATURE_NAMES[featureKey]}</h3>
            </div>

            <div className="ml-6">
              <Switch
                aria-label={BETA_FEATURE_NAMES[featureKey]}
                checked={betaFeatures[featureKey]}
                onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
              />
            </div>
          </div>
        </div>
      ))}

    </div>
  );
}
