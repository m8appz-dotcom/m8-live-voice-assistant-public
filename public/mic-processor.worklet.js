class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(4096)
    this.bufferIndex = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    
    const channel = input[0]
    
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex++] = channel[i]
      if (this.bufferIndex >= this.buffer.length) {
        // Send a copy to avoid transfer array buffer issues
        this.port.postMessage(new Float32Array(this.buffer))
        this.bufferIndex = 0
      }
    }
    
    return true
  }
}

registerProcessor('mic-processor', MicProcessor)
