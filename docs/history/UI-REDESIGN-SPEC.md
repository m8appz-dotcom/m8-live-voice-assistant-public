# M8 Live UI Redesign Spec

## Reference
See `reference-ui.jpg` in this directory for the target design.
See `stitch-reference/` folder for the full Stitch export:
- `stitch-reference/code.html` -- FULL working HTML/Tailwind reference implementation (USE THIS AS PRIMARY SOURCE)
- `stitch-reference/DESIGN.md` -- Design system: "The Sonic Void" (colors, typography, elevation rules)
- `stitch-reference/screen.png` -- Rendered screenshot

## Summary
Redesign the Live tab (orb tab) in `app/live.tsx` to match the broadcasting UI reference. The overall layout replaces the 3D orb with an audio spectrum visualizer and adds a glass-morphism control dock.

## CRITICAL RULES
- DO NOT touch any WebSocket, audio engine, Gemini API, tool call, or business logic. Only UI/render changes.
- DO NOT remove the Chat tab or its functionality.
- DO NOT remove NativeOrb or ThreeOrb components -- keep them but they won't be rendered in the Live tab anymore (keep imports for potential future use).
- Keep all state variables, hooks, and effects intact.
- The app is React Native (Expo) targeting both web and Android. Use `Platform.OS` guards where needed.
- Keep existing Ionicons imports. Add no new icon libraries.

## Design Changes (Live Tab Only)

### 1. Header (replace current header)
- Centered: "M8" in cyan (#00ffff) + " LIVE" in white, font-weight 700, letter-spacing 2
- Right side: vertical dots menu icon (Ionicons "ellipsis-vertical")
- Clean, no border-bottom

### 2. Status Area (below header, centered)
- State label in caps, letter-spacing 3, font-size 11, color based on state (same stateColor map)
- Below that: last model chat message (transcript) in white, font-size 18, font-weight 500, max 2 lines
- Below that: "LIVE" badge -- small pill with green dot + "LIVE" text, only when connected

### 3. Audio Spectrum Visualizer (replaces orb)
- Takes up the main content area (flex: 1)
- ~40 vertical bars, evenly spaced with 3-4px gap
- Each bar: 2-3px wide, linear-gradient from cyan (#00ffff) bottom to green (#00fc97) top
- Subtle glow/shadow: `0 0 15px rgba(0, 255, 255, 0.3)`
- Heights driven by audio data:
  - When `state === 'responding'`: use `audioLevel` to animate bar heights (frequency visualization)
  - When `state === 'listening'`: use `micLevel` to animate
  - When idle/ready: gentle ambient animation (subtle random heights, low amplitude)
  - When disconnected: all bars at minimum height (5%)
- For WEB: use the existing AnalyserNode (`outputAnalyserRef`) to get frequency data and drive individual bar heights
- For NATIVE: use `audioLevel` / `micLevel` scalar to generate pseudo-random bar distribution (since we don't have per-frequency data natively)
- Center the bars vertically in the container
- Bars should have rounded tops (borderTopLeftRadius: 1, borderTopRightRadius: 1)

### 4. Glass Dock (replaces current pill controls)
- Positioned above tab bar, centered horizontally
- Glass morphism: `rgba(38, 38, 38, 0.4)` background + `backdrop-filter: blur(32px)` (web) or semi-transparent dark bg (native)
- Rounded pill shape: borderRadius 40, paddingHorizontal 24, paddingVertical 12
- 3 buttons inside, evenly spaced:
  - LEFT: Camera toggle (Ionicons "videocam" / "videocam-off"), 40x40 circle
  - CENTER: Mic button -- LARGER (56x56 circle), cyan (#00ffff) background when active, dark when off. This is the hero button.
  - RIGHT: Speaker/volume (Ionicons "volume-high" / "volume-mute"), 40x40 circle
- Connect/disconnect: long-press mic button to connect, or add a subtle connect indicator
- Keep existing connect/disconnect, mic, camera logic -- just restyle the buttons

### 5. Tab Bar
- Keep as-is but update icons:
  - LIVE tab: use "radio" icon (Ionicons), with `((•))` broadcasting style
  - CHAT tab: use "chatbubble-outline" or "laptop-outline" (match reference)
- Active color: cyan (#00ffff)

### 6. Colors
- Background: pure black #000000
- Primary/accent: cyan #00ffff
- Secondary: green #00fc97
- Surface: #1f1f1f
- Text: white #ffffff
- Muted text: #ababab

### 7. Thinking/Searching badges
- Keep PulseBadge component
- Position between status text and visualizer

### 8. Transcript display
- Show the last `chat` item where `role === 'model'` as the transcript text below the status label
- Truncate to 2 lines with ellipsis
