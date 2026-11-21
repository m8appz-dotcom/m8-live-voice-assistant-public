```markdown
# Design System Strategy: The Sonic Void

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Void."** Unlike standard dark modes that use charcoal grays, this system embraces a pure pitch-black (#000000) foundation. The UI should feel like a high-end audio cockpit floating in deep space—where only the most essential information is illuminated by "light-matter" (our vibrant gradients).

We break the "template" look by eschewing rigid grids in favor of **intentional asymmetry**. Primary controls are often offset or floating, and the audio spectrum acts as a living, breathing structural element rather than a static widget. This is a "Zero Noise" philosophy: if an element does not vibrate with audio data or facilitate a direct action, it should recede into the void.

---

## 2. Colors & Surface Philosophy
The palette is a high-contrast dialogue between the absolute absence of light and hyper-vibrant neon energy.

### The "No-Line" Rule
**Prohibit 1px solid borders for sectioning.** To maintain the "Futuristic" aesthetic, boundaries must be defined solely through background color shifts. For example, a playback dock should use `surface_container_low` against the `surface_dim` background. If you feel the need to draw a line, use negative space (spacing `4` or `6`) instead.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked, semi-transparent layers.
*   **Base Level:** `surface_container_lowest` (#000000) – The infinite void.
*   **Secondary Level:** `surface_container` (#191919) – For persistent areas like side drawers.
*   **Active Overlays:** `surface_bright` (#2c2c2c) at 40% opacity with a 20px backdrop blur.

### The "Glass & Gradient" Rule
Main CTAs and "Live" indicators must use a linear gradient: `primary_container` (#00ffff) to `secondary` (#00fc97). This transition from Electric Cyan to Neon Green provides a "visual soul" that feels kinetic and alive, mimicking the energy of live audio.

---

## 3. Typography
The typography strategy balances the technical precision of **Space Grotesk** for data/headers with the high readability of **Inter** for functional UI.

*   **Display & Headlines (Space Grotesk):** Used for stream titles and "ON AIR" status. Increase `letter-spacing` by 0.05rem to 0.1rem for all `display-lg` and `headline-md` types to evoke a premium, editorial feel.
*   **Body & Labels (Inter):** Keep these clean and functional. Use `on_surface_variant` (#ababab) for secondary metadata to ensure it doesn't compete with the primary audio data.
*   **Identity through Scale:** We use an aggressive contrast between `display-lg` (3.5rem) for viewer counts and `label-sm` (0.6875rem) for technical bitrates. This "Editorial Brutalism" highlights the importance of the data.

---

## 4. Elevation & Depth
In a pure black environment, traditional shadows are invisible. We achieve depth through **Tonal Layering** and **Luminescence**.

*   **The Layering Principle:** Place a `surface_container_high` card on top of a `surface_dim` background to create a "soft lift." The difference in dark tones suggests depth without clutter.
*   **Ambient Glows:** Instead of drop shadows, use "Outer Glows." Floating buttons (like the Mic Toggle) should have a 12px blur shadow using `primary` at 15% opacity. This mimics how a neon light interacts with a dark room.
*   **The "Ghost Border" Fallback:** If accessibility requires a container boundary, use `outline_variant` (#484848) at **15% opacity**. It should be felt, not seen.
*   **Glassmorphism:** All control docks (bottom sheets) must use a 60% opacity `surface_container_highest` with a heavy `backdrop-filter: blur(24px)`.

---

## 5. Components

### Audio Spectrum (Signature Component)
The core of the experience. 40 thin vertical bars using the `primary` to `secondary` gradient.
*   **Interaction:** Height scales with frequency data. 
*   **Styling:** No rounded corners on bars; sharp, 1px-wide lines for a "scientific instrument" look.

### Buttons
*   **Primary (Live/Action):** Circular "Ghost" style. A 2px stroke of the `primary_fixed` gradient with no fill. On hover/active, fill with 10% `primary_fixed`.
*   **Secondary:** `surface_container_highest` background with `on_surface` text. No border.

### Chips (Genre/Tags)
*   **Style:** Pill-shaped (`full` roundedness). Use `surface_container_low` for the background.
*   **Active State:** Text switches to `primary_dim` with a subtle 4px bottom-glow.

### Lists & Navigation
*   **Forbid Dividers:** Use `spacing.6` (2rem) of vertical white space to separate stream items.
*   **Selection:** An active list item is indicated by a vertical 2px line of `primary` on the far left, rather than a background color change.

### Input Fields
*   **Style:** Minimalist underline using `outline_variant` at 30% opacity. 
*   **Active:** The underline expands to 2px and transitions to the `primary` cyan.

---

## 6. Do’s and Don'ts

### Do:
*   **Do** use "Pitch Black" (#000000) for the main background. True black on OLED screens creates the illusion of the hardware disappearing.
*   **Do** use `primary_fixed_dim` for icons to ensure they "pop" against the dark surfaces.
*   **Do** embrace asymmetry. Center the audio visualizer but keep metadata left-aligned to create visual tension.

### Don’t:
*   **Don’t** use solid white (#ffffff) for large blocks of text. Use `on_surface_variant` (#ababab) to prevent eye strain and "light bleed" in dark environments.
*   **Don’t** use standard Material Design elevations (dp1, dp2). Stick strictly to the Surface Tiers and Tonal Layering defined in this system.
*   **Don’t** add borders to cards. If a card isn't visible against the background, your `surface_container` choice is too dark—step up one tier.