type PromptPresetReadStage = {
  name: string;
  run: () => Promise<unknown>;
};

export async function preparePromptPresetRead(
  stages: PromptPresetReadStage[],
): Promise<void> {
  for (const stage of stages) {
    try {
      await stage.run();
    } catch (error) {
      console.error(
        `[prompt-presets] read preparation failed at ${stage.name}`,
        error,
      );
    }
  }
}
