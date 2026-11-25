// SIGTERM handlers in the existing workers finish their current batch before exiting.
// Deliver the request within Node so Windows gets the same cooperative behavior.
if (process.channel) {
  function drain(message) {
    if (message !== "desktop:worker-idle") return;
    if (!process.emit("SIGTERM")) return;
    process.off("message", drain);
    process.disconnect();
  }
  process.on("message", drain);
  process.channel.unref();
}
