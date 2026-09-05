# AR/VR renovation visualization — feasibility spike

No code in this pass. This is a planning document for a future pass that
wants to build the real thing, instead of leaving "needs Module 22,
deliberately not attempted" as the only note on it. It exists because
the honest answer to "why not just build it" turned out to need more
than one sentence.

## 1. What this scaffold has today

`RenovationVisualization` (`apps/api/prisma/schema.prisma`) is 2D only:

```prisma
model RenovationVisualization {
  id                String    @id @default(uuid())
  propertyId        String
  projectId         String?
  requestedByUserId String
  prompt            String
  beforeImageUrl    String
  afterImageUrl     String?
  status            String    @default("pending") // pending | completed | failed
  errorMessage      String?
  createdAt         DateTime  @default(now())
  completedAt       DateTime?
}
```

The pipeline: a user supplies one existing photo (`beforeImageUrl`) and a
text prompt; `OpenAiImageService` calls OpenAI's Images *edit* endpoint
(edits the actual photo, not a from-scratch generation); the result is
persisted to Cloudflare R2 via `StorageService` and saved as
`afterImageUrl`. One photo in, one edited photo out. No 3D data, no
scene, no camera pose, no live device input — verified live this session
(the storage half; the actual OpenAI call is blocked on this account's
billing, unrelated to what's described here).

There is currently **zero** 3D/AR/mobile infrastructure in either
workspace — no Three.js/react-three-fiber/Babylon/A-Frame, no WebXR
polyfills, no React Native/Expo/Unity project, nothing. This is
confirmed by grep, not assumed. "Real AR/VR" is greenfield relative to
everything else in this repo.

## 2. What "real AR/VR renovation visualization" actually means

The blueprint's phrase is doing a lot of work. Unpacking it into the
four separable technical problems it actually contains — because they
have different owners, different costs, and can be sequenced
independently:

1. **Capture** — turning a real room into 3D data the rest of the
   pipeline can use.
2. **Rendering runtime** — the thing that shows a live camera feed with
   virtual objects/materials composited into it, tracked to the real
   room as the device moves.
3. **Content** — where the "renovated" 3D materials/furniture/finishes
   actually come from.
4. **Data model & backend** — what a `RenovationVisualization`-equivalent
   row needs to hold once it's no longer just two image URLs.

Each is scoped below.

## 3. Capture: turning a room into 3D data

| Approach | What it needs | Maturity / cost signal |
|---|---|---|
| **LiDAR scan** (iPhone 12 Pro+/iPad Pro) | ARKit's `ARSceneReconstruction` API, a native iOS app | Best quality, but restricted to LiDAR-equipped Apple devices only — excludes the large majority of phones a landlord or tenant actually owns |
| **Photogrammetry from multiple photos** | Either a self-hosted pipeline (COLMAP, Meshroom — both free, both require real GPU compute and are not fast) or a paid API (Polycam, Luma AI, Matterport Capture) | The self-hosted route is a genuine ML-infra project on its own, not a feature; the paid-API route is the realistic option, and it's a recurring per-scan cost, not a one-time integration |
| **NeRF / Gaussian Splatting from a phone video** | Similar paid-API landscape (Luma AI again, among others) as of this writing; open-source implementations exist but are research-grade, not production SDKs | Same cost profile as above — outsource or don't do it |
| **No real 3D capture — flat-photo-plus-depth-estimate** | A monocular depth-estimation model (e.g. run the existing photo through a depth model) to approximate a 3D plane, not a full scan | The only option with no new hardware and no per-scan external cost, but it's a genuine downgrade from "real AR" — good enough for "paint this wall a different color," not for "walk around and see furniture from every angle" |

**There is no free, high-quality, self-hosted option here.** Every path
that produces a walkable 3D room either needs specific hardware (LiDAR)
or a paid third-party service. That's the first concrete fact a future
pass needs to accept before scoping a budget.

## 4. Rendering runtime: where the AR actually happens

This is the fork that decides almost everything else about project
shape.

### Option A — WebXR (stays a web app)

- Uses the `WebXR Device API` directly, or a wrapper like `three.js`'s
  `WebXRManager` / `@react-three/xr` on top of the existing Next.js app.
- **The blocker**: WebXR's `immersive-ar` session mode has real support
  on Chrome for Android, and effectively none on Safari/iOS as of this
  writing — Apple's own answer for iOS is AR Quick Look (`.usdz`
  file → system AR viewer) and native ARKit, not WebXR. A renovation
  visualizer that only works for Android visitors isn't a serious
  cross-platform feature for a real-estate product.
- Cheapest to build *if* the iOS gap were acceptable; it isn't, for a
  consumer-facing feature where a meaningful share of users are on
  iPhones.

### Option B — Two native apps (iOS/ARKit + Android/ARCore)

- The "actually works everywhere" option. ARKit (`RealityKit` or
  `SceneKit`) on iOS, ARCore (`Sceneform`'s successor, or raw ARCore +
  Filament) on Android.
- Means starting two new codebases in two new languages (Swift/Kotlin,
  or Objective-C/Java), completely outside this repo's Next.js/NestJS
  stack. This is not "add a package" — it's standing up mobile
  engineering as a discipline this project doesn't currently have.

### Option C — Cross-platform native (Unity + AR Foundation, or React Native + a native-AR bridge like ViroReact)

- One codebase targets both platforms via AR Foundation's abstraction
  over ARKit/ARCore.
- Unity means a second, unrelated engine/toolchain and a second
  deployment pipeline (app store submissions) alongside the existing
  Next.js/NestJS one — real overhead, but genuinely less than two fully
  separate native codebases.
- React Native + a community AR bridge is lower-commitment than Unity
  but the AR-specific bridges in this space have historically been
  thinly maintained — this needs a fresh maturity check at build time,
  not an assumption baked in now.

**There is no version of "real AR" that ships from inside this
repo's existing web app and works acceptably on iOS.** That's the
second concrete fact a future pass needs to accept. Every option that
covers both platforms properly means a new client outside `apps/web`.

## 5. Content: where the renovated 3D materials come from

Even with capture and rendering solved, "renovate this room in AR" needs
3D content to place into the scanned space:

- **Material/texture swap only** (repaint a wall, re-tile a floor) —
  the cheapest real content problem: apply a new material to an existing
  detected plane. No 3D asset library needed, just the scanned surfaces
  themselves.
- **Furniture/fixture placement** — needs an actual 3D asset library
  (a marketplace like Sketchfab's API, a paid catalog, or commissioning
  models) in a real-time format (glTF/GLB, or USDZ for Apple's own
  viewer). This is a content-licensing and content-pipeline problem as
  much as an engineering one.
- **AI-generated 3D assets from a text prompt** — the direct 3D
  analogue of what `OpenAiImageService` already does in 2D, but
  image-to-3D/text-to-3D generation is meaningfully less mature than
  2D image generation as of this writing: geometry quality and texture
  fidelity are inconsistent enough that most production AR/e-commerce
  work still leans on curated asset libraries, not generative 3D, for
  anything customer-facing.

The material/texture-swap slice is the only one of the three that's
actually bounded with today's technology and no new content-licensing
relationship.

## 6. Data model & backend changes a real version would need

Sketched, not built — this section exists so a future pass doesn't have
to re-derive it:

- A capture/scan entity distinct from a single `beforeImageUrl` — at
  minimum a reference to the scanned/reconstructed 3D asset (a `.glb`/
  `.usdz` file URL, using the R2 storage this pass's upload pipeline
  already provides), plus whatever metadata the chosen capture
  provider (§3) returns (a job/scan id, processing status, quality
  score).
- A processing-status lifecycle that's genuinely async and can take
  minutes, not the synchronous request/response `VisualizationsService`
  uses today — photogrammetry/NeRF reconstruction is not a fits-in-one-
  HTTP-request operation the way a single OpenAI image edit is. This
  scaffold has no job queue anywhere yet (an existing, separately-
  flagged gap); a real capture pipeline would need one, or would need to
  poll a third-party provider's own async job API instead.
- A placement/scene-graph table if furniture placement (not just
  material swap) is in scope — positions, rotations, and asset
  references for each placed object, scoped to a given scan.
- Mobile-app-facing API surface: today's API assumes a browser client
  (httpOnly cookies + CSRF, per this codebase's own auth-hardening
  pass). A native mobile client can't use httpOnly cookies the same
  way — this is the exact "a production system serving non-browser
  clients too would need a second auth mechanism (API keys) alongside
  this one" gap the auth-hardening section of the README already names
  for an unrelated reason, but AR is the first concrete feature that
  would actually force resolving it.

## 7. The honest recommendation: a bounded first slice, not "build AR"

None of the above is "a bounded addition to this scaffold the way
everything else has been" — the README's own phrase for why this stayed
out of scope. But there is one slice that is:

**Phase 0 — material/color preview using WebXR hit-testing, Android-only, explicitly labeled as a preview, not a product feature:**
- `@react-three/xr` (or raw WebXR) added to the existing `apps/web`
  Next.js app — no new codebase.
- WebXR's hit-test API detects a real-world plane (a wall or floor) the
  user points their (Android) camera at.
- A material/texture (not a full 3D asset) is composited onto that
  detected plane in real time — "what would this wall look like in a
  different color/finish."
- No photogrammetry, no scan storage, no 3D asset library, no mobile
  app, no new auth mechanism — it reuses this pass's own R2 upload
  pipeline for the texture images and needs at most one new lightweight
  model for "which material was tried against which property."
- Explicitly iOS-excluded and explicitly labeled as such in the UI —
  honest about the WebXR gap in §4 rather than silently degrading for
  half of visitors.

This phase does not deliver on "AR/VR renovation visualization" as the
blueprint means it — it's a real-time wall-color preview, not a walkable
renovated room. But it is buildable inside the existing repo, with no
new codebase, no per-scan external cost, and no content-licensing
relationship — which nothing else in this document is. It would also be
the first concrete proof this repo has that a client can hold a live
camera/WebXR session at all, which every later, larger phase depends on.

**Every phase past that — real furniture placement, iOS parity, actual
room reconstruction — is a native-mobile-app-sized initiative in its own
right**, not a feature to slot into an existing sprint. A future pass
picking this up should treat "start a native (or Unity/AR-Foundation)
mobile codebase" as its own separately-scoped project, informed by
whichever capture provider (§3) and content strategy (§5) get chosen —
not as an extension of this one.

## 8. Open decisions a future pass needs made before writing code

1. Is Phase 0 (material preview, Android/WebXR-only) an acceptable
   product scope on its own, or is "AR that also works on iPhone" a hard
   requirement from day one? This determines whether Phase 0 is worth
   building at all versus going straight to a native mobile project.
2. Which paid capture provider (Polycam / Luma AI / Matterport / other)
   if/when real room reconstruction is greenlit — this is a vendor and
   budget decision, not an engineering one, and should be made before
   any reconstruction-pipeline code is written.
3. Material-swap-only vs furniture placement as the actual product
   goal — these have very different content-pipeline costs (§5) and
   should be decided independently of the rendering-runtime choice.
4. Whether a second, mobile-facing auth mechanism (§6) gets built now,
   speculatively, or only once a real mobile client exists to consume
   it — building it speculatively risks the same "infrastructure nobody
   uses yet" trap this document is trying to avoid for AR itself.
