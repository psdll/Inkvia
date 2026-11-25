class CanvasPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor("canvas-pcm-capture", CanvasPcmCaptureProcessor);
