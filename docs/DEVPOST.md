# Devpost submission draft

Copy each section into the matching Devpost field. Fill in the `[brackets]`
before submitting.

---

## Project name

HeatHunter

## Tagline (short)

A check-engine light for your home's heat: physics finds the leaky room, and why.

## Built with (tags)

python, fastapi, pydantic, numpy, scipy, react, typescript, three.js,
react-three-fiber, glsl, d3, framer-motion, tailwindcss, vite, openai,
anthropic-claude, open-meteo, uk-data-service

## Links

- GitHub: https://github.com/AnujDakhara7888/HeatHunter
- Demo video: `[YouTube link, unlisted]`

---

## Inspiration

Homes leak heat through draughty gaps and poorly insulated walls, and most
people only find out from the bill. A professional energy audit costs hundreds
of pounds. We wanted to know how much a few cheap temperature sensors and
physics could tell you instead.

## What it does

HeatHunter watches a home night after night once the heating switches off, and
measures how fast each room cools.

- **Three suspects per room.** Every night it fits three physical models to
  each room: normal, air leak, and weak insulation. It compares them
  statistically.
- **The wind decides.** A leak loses more heat on windy nights and a weak wall
  doesn't. Nights with different weather tell the two apart. A room is flagged
  after two nights in a row above its alarm level, and the cause is named only
  when one explanation clearly wins.
- **Cost and advice.** It estimates the yearly cost, a typical repair cost and
  the payback, then lists what to check.
- **Confirms the fix.** You do the repair yourself. HeatHunter judges only the
  nights after it and tells you whether the problem is gone.

You can try it on a **digital twin of a real UK bungalow** (SMETER house HH09)
running on real winter weather. A judge can secretly plant a fault, and the app
has to find it. The 3D house opens up and can be walked through. An infrared
view reads out each room's measured temperature. An **Analytics** page shows
the story and the maths as of any night. A chat explains everything in plain
English.

## How we built it

- **Physics engine (Python, NumPy/SciPy).** A per-room thermal model with fabric
  heat storage and an air layer, coupled to the outdoors and neighbouring
  rooms. Air leakage follows the ASHRAE/LBL stack-and-wind law, and glazing
  uses SAP 2012 values. Each hypothesis is fitted to the readings and compared
  by BIC.
- **Digital twin and hidden faults.** A simulator of HH09 plants a fault in one
  room and generates realistic, noisy temperatures from real SMETER weather.
  The hidden answer is stored separately. The diagnosis code can't import it
  (a test enforces this), and only the Reveal button can read it.
- **The flag rule.** An alarm level of `a + b/√nights` per cause, with
  persistence and a cause gap. It was tuned on 192 simulated houses from winter
  2019-20, with half held back for checking. The live demo uses the held-out
  winter 2020-21.
- **API.** FastAPI and Pydantic contracts. OpenAPI generates the TypeScript
  types, so the frontend and backend can't drift apart.
- **Frontend.** React 19 and Three.js (react-three-fiber) with a custom GLSL
  infrared shader, first-person walk-in, d3 charts, Framer Motion and Tailwind.
- **AI chat.** OpenAI or Claude, given only the server's public results. It
  explains results and can move the 3D camera, but it never diagnoses.

## Challenges we ran into

- **One night isn't enough.** Our first design judged a single night, and it
  could tell only **3 of 32** air leaks apart from weak walls. On a calm night
  the two cool a room almost identically. We redesigned the whole product to
  watch night after night, and with mixed weather that reached 30 of 32.
- **Honest separation between simulator and detective.** Keeping the planted
  fault invisible to the diagnosis took strict module boundaries, enforced by
  tests.
- **Physics details.** A single-temperature room model couldn't explain fast
  air-temperature swings. We added an air layer, window losses and air-to-air
  coupling between rooms.
- **Four people, one product.** Physics, simulation, data and UI were built in
  parallel against a shared typed API contract.

## Accomplishments that we're proud of

- The full loop works live: plant a fault, watch the nights, flag, name the
  cause, repair, confirm, reveal.
- On simulated check houses: weak insulation caught (right room and cause) in
  35 of 36, air leaks in 30 of 36, and 1 false alarm in 24 healthy houses.
- A UI that a homeowner can read in seconds and an engineer can dig into.
- 254 automated tests, including ones that check the hidden answer never leaks
  before the reveal.

## What we learned

- Heat-transfer modelling and statistical model comparison (BIC), and why
  evidence over time beats a single measurement.
- Three.js and shaders for a data-driven 3D house.
- Designing typed contracts so four people's modules fit together.
- `[Personal: what each of you usually builds, and what was new this time]`

## What's next for HeatHunter

- Connect real low-cost sensors (for example Zigbee or ESP32 thermometers)
  instead of CSV uploads.
- Validate on real homes with known, measured faults.
- Bring back the optional fan test as a guided at-home experiment for rooms
  whose cause is still unclear.

## Honest limits (keep this in)

The Fault Lab house is an approximate digital twin: its room temperatures and
faults are simulated, and only the weather is real. We make no claim that the
real HH09 house has a fault. The rule was tuned on simulated homes, and costs
are screening estimates, not quotes.

## Data credit

Allinson, D. et al. (2024). *Technical Evaluation of SMETER Technologies Project
Phase 2 Data.* UK Data Service, SN 856978. Weather for user homes: Open-Meteo.

---

## Mapping to the judging criteria (say these out loud)

- **Technology:** fitted physics models compared by BIC; wind separates the
  causes; a digital twin on real weather; a GLSL infrared shader; a typed API.
- **Design:** a 3D house you can open and walk into, an infrared view, and
  two-layer Analytics with very little text.
- **Completion:** the whole loop runs live, with a judge-planted fault and 254
  tests.
- **Learning:** the single-night dead end (3 of 32) and the redesign, plus the
  new skills above.

## Screenshots for the gallery

Upload from `docs/images/`: `fault-lab.jpg`, `analytics-story.jpg`,
`analytics-suspects.jpg`, `infrared.jpg`, `analytics-under-the-hood.jpg`,
`landing.jpg`.
