# Lift Recap

You end your **Functional Strength Training** workout on Apple Watch. Your iPhone then opens a clean recap of what you did in the gym: the estimated exercises, sets and rest, your effort, recovery and coaching notes.

**Live (once merged to `master`):** https://jayesh1302.github.io/gym/
**Demo:** https://jayesh1302.github.io/gym/#demo

There is nothing to install and no account or server. Everything stays in your browser.

---

## The plan

### The constraint
Apple Watch has no web API, and only a native watchOS app can read wrist motion (accelerometer/gyroscope). The data a no-install solution *can* reach is what the workout saves to **Apple Health**, mainly **heart rate**, sampled every few seconds during a workout.

### The approach (Phase 1, built)
1. **Hand-off: an iPhone Shortcut.** It runs automatically when an Apple Watch strength workout ends. It reads the last 3 hours of heart-rate samples from Health and opens this page with the data in the URL (`#data=…`). It also copies the data to the clipboard as a backup.
2. **Inference engine** (`engine.js`, pure JS):
   - **Sets.** Each set makes HR climb and each rest lets it fall, so the trace looks like a saw blade. A zig-zag filter with an adaptive threshold finds every climb (= set) and fall (= rest). Set start is refined by walking back from the peak to where HR started rising.
   - **Workout window.** Finds the longest stretch of elevated HR, so the drive to the gym is ignored. You can adjust it manually.
   - **Exercises.** A rest much longer than your usual rest, or a sudden change in effort profile, means you switched exercise.
   - **Exercise type.** HR rise per set, peak %HRmax and position in the session sort each block into *heavy compound* (squat, deadlift, bench), *compound*, *accessory/isolation*, *core* or *conditioning*.
   - **Exercise name.** The type, your focus for the day (Push/Pull/Legs/Upper/Lower/Full) and **the names you confirmed last time for that focus** give the most likely exercise. Each guess shows alternatives and a confidence level.
3. **Coach metrics:** duration, sets, training load (Banister TRIMP), calories (Keytel formula or watch data), HR zones, typical rest vs. your goal, work density, and 60-second heart-rate recovery and how it trends (a fatigue signal). It also flags HR creeping up set to set and compares this session with your last one of the same focus.
4. **Coach notes:** rule-based feedback on rest, fatigue, density, session length and progression, plus an **"Ask Claude coach"** button. It copies a structured summary you can paste into Claude for a full session review and a plan for next time.
5. **You correct it, and it learns.** Tap a name to fix it, merge or split blocks, drop false sets, and log reps × weight if you want volume. Saved sessions shape future guesses.

**Accuracy to expect:** the set count is usually within ±1–2 per exercise. Grouping into exercises is usually right when you rest longer between exercises than between sets. Exercise *names* are educated guesses until you confirm them; after a couple of sessions per focus it mostly just reuses your routine.

### Phase 2: real motion-based recognition (needs a native app)
To *truly* recognize movements and count reps, build a small watchOS companion app:
- Start an `HKWorkoutSession` (Functional Strength Training) so the app runs in the background.
- Stream `CMBatchedSensorManager` / `CMMotionManager` accelerometer + gyroscope data at 50–100 Hz.
- Classify 2–4 s windows with a **Create ML Activity Classifier**, trained on labeled recordings of your own lifts (about 10 sets each). Peak detection on the dominant axis counts reps.
- Write the results to HealthKit or POST them to this same recap UI (it already accepts JSON).

This needs Xcode, a Mac and an Apple Developer account (free for personal sideloading; $99/yr for TestFlight).

### Phase 3: ideas
- Claude API integration for an automatic coach write-up (needs a small backend for the API key).
- Per-exercise progression charts once reps/weights are logged.
- Rest timer and "planned workout" templates.

---

## iPhone Shortcut setup (one time, about 3 minutes)

1. **Shortcuts → + →** name it **Lift Recap**.
2. **Find Health Samples**: Type *Heart Rate*; Start Date *is in the last 3 hours*; Sort by Start Date, Oldest First; no limit.
3. **Repeat with Each** sample:
   - **Format Date**: *Repeat Item → Start Date*, format **ISO 8601**, include time.
   - **Text**: `Formatted Date,Repeat Item→Value`
4. After **End Repeat**: **Combine Text** (Repeat Results, New Lines) → **Copy to Clipboard**.
5. **URL Encode** the combined text → **Text**: `https://jayesh1302.github.io/gym/#data=` + *URL Encoded Text*.
6. **Open URLs**. Run once and allow Health access.
7. **Automation → + → Apple Watch Workout → Ends →** Functional Strength Training → **Run Immediately** → *Run Shortcut: Lift Recap*.

No automation option on your iOS version? Put the shortcut on your Home Screen and tap it after the workout.

## Accepted data formats
- `ISO-timestamp,bpm` lines (from the Shortcut); `HR,…` / `KCAL,…` prefixed lines
- Apple Health export date style `2026-11-25 18:01:05 -0800`
- CSV/JSON from Health Auto Export, or any JSON array of `{date, value}`

## Files
| File | Purpose |
|---|---|
| `index.html` | App shell |
| `app.js` | UI: import, recap, editing, history, setup |
| `engine.js` | Parsing, set/exercise detection, metrics, coach notes, demo data (also runs in Node) |
| `styles.css` | Light/dark theme |
