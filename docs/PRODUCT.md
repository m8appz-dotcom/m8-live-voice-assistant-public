# M8 Live Voice Assistant — product review

The original Expo screen with its green/cyan audio spectrum, Live/Chat views and microphone dock. The hosted export connects that screen to the existing private English voice engine and WebAuthn workspace access.

## Desktop

![Published original screen during an authenticated microphone conversation](images/original-wave-desktop.jpg)

## Phone

![Published original screen at a 390px viewport during the same conversation](images/original-wave-mobile.jpg)

## Try it

Open [M8 Live](https://voice.kennethyepez.com). Sign in with the existing passkey, then use the microphone control to connect. Chat supports typed turns; the speaker control mutes spoken replies. New private accounts require an administrator invitation and passkey. Live conversations require available session capacity. Settings retains the [previous saved workspace](https://voice.kennethyepez.com/workspace/), without moving or overwriting saved data.

These unmodified captures show the public screen after the holder signed in with the existing passkey on 22 November 2026. The microphone produced the transcript “The Green Wave is back.” and an English response; the holder confirmed recognition and audible playback. The wave responded to microphone input. A separate typed question returned “The original interface is ready.” through the real engine. Opening Settings and returning retained both turns. The microphone was stopped after the check.

The 390px capture is a browser viewport check, not a native phone test. Second-authenticator enrollment/recovery remains incomplete; the original passkey and saved copy remain available. These short observations do not establish recognition accuracy, acoustic quality or latency distributions.

[Watch the previous workspace recording](examples/workspace-walkthrough.mp4). This retained historical recording shows the authored replay now available under `/workspace/`. It does not show the restored screen or a completed human authentication flow.
