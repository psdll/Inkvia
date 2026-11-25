export type CreativeAgentImagePreference = {
  mode: 'auto' | 'explicit'; model?: string; unresolvedAlias?: string;
  params?: { aspectRatio?: string; resolution?: string; quality?: string; background?: string };
};
export type CreativeAgentVideoPreference = {
  mode: 'auto' | 'explicit'; model?: string; unresolvedAlias?: string;
  params?: { ratio?: string; resolution?: string; duration?: number; generateAudio?: boolean };
};
export type CreativeAgentPreferences = {
  imageModel?: string; videoModel?: string; // legacy only
  image?: CreativeAgentImagePreference;
  video?: CreativeAgentVideoPreference;
};

/** Canonical fields, including auto, take precedence. Missing stays unset. */
export function resolveCreativeAgentPreferences(preferences?: CreativeAgentPreferences): Pick<CreativeAgentPreferences, 'image' | 'video'> {
  const image = preferences?.image ?? (preferences?.imageModel ? { mode: 'explicit' as const, model: preferences.imageModel } : undefined);
  const video = preferences?.video ?? (preferences?.videoModel ? { mode: 'explicit' as const, model: preferences.videoModel } : undefined);
  return {
    ...(image ? { image: { ...image, ...(image.params ? { params: { ...image.params } } : {}) } } : {}),
    ...(video ? { video: { ...video, ...(video.params ? { params: { ...video.params } } : {}) } } : {}),
  };
}

/** Materialize the run snapshot before action identity, preparation and dispatch. */
export function applyCreativeAgentMediaPreference(args: Record<string, unknown>, preference?: CreativeAgentImagePreference | CreativeAgentVideoPreference): Record<string, unknown> {
  if (!preference) return args;
  const fixedParams = Object.fromEntries(Object.entries(preference.params ?? {}).filter(([, value]) => value !== undefined));
  return {
    ...args,
    ...(preference.mode === 'explicit' ? { model: preference.model } : {}),
    ...(Object.keys(fixedParams).length ? { params: { ...(args.params as Record<string, unknown> | undefined), ...fixedParams } } : {}),
  };
}

/** A prior result supplies only verified per-target settings; current hard leaves win. */
export function creativeContinuationPreference(preference: CreativeAgentImagePreference | CreativeAgentVideoPreference | undefined, requirements: import('./matching-contracts').TurnRequirements | undefined, mediaType: 'image' | 'video', references: unknown) {
  const targets = requirements?.continuation?.targets.filter(target => target.mediaType === mediaType && Array.isArray(references) && references.some(ref => ref.nodeId === target.reference.nodeId && ref.semanticHash === target.reference.semanticHash && ref.batchId === target.reference.batchId && ref.outputId === target.reference.outputId)) ?? [];
  if (!targets.length) return preference;
  const params: Record<string, unknown> = { ...preference?.params, ...targets[0].params };
  for (const fact of requirements?.facts ?? []) if (fact.strength === 'hard' && fact.field.startsWith(mediaType + '.params.')) {
    const key = fact.field.split('.')[2];
    // effectivePreferences already applies correction/answer precedence.
    params[key] = (requirements?.effectivePreferences[mediaType].params as Record<string, unknown> | undefined)?.[key];
  }
  return { ...preference, mode: preference?.mode ?? 'auto', params };
}
