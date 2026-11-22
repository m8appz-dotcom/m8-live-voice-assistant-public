// Only one request may own a pending capture. Ownership transfers to attach()
// after both acquisition and audio-context resume succeed.
export function createMicrophoneRequest({
  acquire,
  resume,
  attach,
  isClosed,
  onError,
  onPending,
}) {
  let pending = false,
    generation = 0;
  return {
    cancel() {
      generation++;
    },
    async start() {
      if (pending || isClosed()) return;
      pending = true;
      const current = ++generation;
      let stream = null;
      onPending(true);
      try {
        stream = await acquire();
        if (isClosed() || current !== generation) return;
        await resume();
        if (isClosed() || current !== generation) return;
        attach(stream);
        stream = null;
      } catch {
        if (!isClosed() && current === generation) onError();
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
        pending = false;
        onPending(false);
      }
    },
  };
}
