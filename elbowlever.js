// 💪 ELBOW LEVER FORM SCORING
// Scope (v1): standard two-arm elbow lever — hands on the ground, elbows
// tucked into the sides of the waist/hip, body held roughly horizontal and
// as level as possible, legs extended straight out. One-arm elbow lever and
// deliberately piked/planche-transition variations are out of scope for now.
//
// Static hold, scored once via one representative pose across the whole
// clip — same median-across-the-clip approach as handstand.js/lsit.js.
// Filmed from the side (the only angle that shows the elbow tuck and body
// level clearly), so this is side-aware like lsit.js/pushup.js rather than
// requiring both sides visible every frame.
//
// Two checks here don't exist in any other skill file, because no other
// skill needed them:
//   1. Elbow tuck distance — the defining feature of this skill is the
//      elbow posted against the hip/waist as the support point, which is a
//      PROXIMITY check (distance between two joints), not an angle. Every
//      other skill only ever needed angles.
//   2. Level-with-ground tilt — handstand/L-sit/HSPU all care about a
//      straight LINE (angleBetween handles that regardless of the line's
//      absolute orientation), but elbow lever additionally needs that line
//      to be roughly horizontal specifically, not just straight. A body
//      held in a perfectly straight but 30°-pitched line would pass every
//      existing straightness check and still be bad form here.
//      Unlike L-sit's forward/back torso lean (which we can't safely call
//      a direction for, since that depends on which way the athlete faces
//      the camera), sagging vs. lifting IS safely directional here: "up"
//      and "down" in the frame don't depend on which way the athlete
//      faces — so this one names the direction.
//
// Shared geometry/landmark helpers live in pose-utils.js, loaded before this file.

// 🔒 Wrapped in an IIFE so internal names stay private to this file and
// can't collide with another skill file's same-named internals — only
// scoreElbowLever itself is exposed globally.
const scoreElbowLever = (function () {
  const MIN_CONFIDENT_FRAMES = 15; // Elbow lever holds are often brief while learning — ~0.5s of clearly tracked frames is enough for one stable reading

  const isFrameConfident = (landmarks) =>
    isSideVisible(landmarks, LEFT_SIDE_LANDMARKS) || isSideVisible(landmarks, RIGHT_SIDE_LANDMARKS);

  // Body-line straightness thresholds — same style/values as handstand.js's
  // shoulder/hip/leg checks, since "one straight line" is required here too.
  const BODY_ALIGN_DEVIATION_THRESHOLD = 12; // shoulder-hip-ankle deviation from 180°
  const LEG_BEND_DEVIATION_THRESHOLD = 10;    // hip-knee-ankle deviation from 180°

  // Elbow support angle — unlike handstand/HSPU (arms locked straight) or
  // crow (arms bent sharply into a shelf), elbow lever wants a moderate,
  // specific bend: enough to post the forearm as a stable vertical strut,
  // not so much that the arm collapses, not so little that it's basically
  // a straight-arm plank (a different skill entirely).
  const ELBOW_TOO_STRAIGHT_THRESHOLD = 130; // Above this, the arm isn't really "levered" at all
  const ELBOW_TOO_COLLAPSED_THRESHOLD = 40;  // Below this, the support is folding rather than posting

  // Elbow tuck — how far the elbow sits from the hip, as a ratio of
  // upper-arm length (shoulder-to-elbow distance) so it scales with camera
  // distance/subject size rather than needing a raw pixel cutoff.
  const ELBOW_TUCK_RATIO_WARNING = 0.6;
  const ELBOW_TUCK_RATIO_MAJOR = 1.0;

  // Level-with-ground tilt, in degrees off perfectly horizontal.
  const LEVEL_DEVIATION_WARNING = 12;
  const LEVEL_DEVIATION_MAJOR = 25;

  // Measures how far a shoulder->ankle line tilts from perfectly
  // horizontal, in degrees, regardless of which horizontal direction the
  // body extends in frame (left-facing vs. right-facing side-on shots).
  // Positive = the far end (ankle) sits lower than the shoulder (sagging);
  // negative = the far end sits higher (piking/lifting).
  function tiltFromHorizontalDegrees(near, far) {
    if (!near || !far) return null;
    const dx = Math.abs(far.x - near.x);
    const dy = far.y - near.y;
    if (dx === 0 && dy === 0) return null;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }

  // history: array of frames collected across the ENTIRE video, each frame
  // being the raw `results.poseLandmarks` array MediaPipe gives you. Call
  // this once, after the video has finished playing — not per-frame — so
  // the result is one final, stable rating rather than a live number that
  // shifts during playback.
  // videoWidth/videoHeight: the source video's native pixel dimensions —
  // required to correct for non-square aspect ratios before computing angles.
  return function scoreElbowLever(history, videoWidth, videoHeight) {
    const confidentFrames = history.filter(isFrameConfident);

    if (confidentFrames.length < MIN_CONFIDENT_FRAMES) {
      return {
        status: "low_confidence",
        message:
          "Couldn't get a clear enough view of your arms, hips, and legs for enough of the video to score this elbow lever. Try filming from the side with your whole body in frame.",
      };
    }

    // One representative position per joint across the whole clip, already
    // in pixel space and side-aware (real visible-side point rather than a
    // hidden-side guess).
    const shoulder = medianJointPoint(confidentFrames, videoWidth, videoHeight, "shoulderMid");
    const elbow = medianJointPoint(confidentFrames, videoWidth, videoHeight, "elbowMid");
    const wrist = medianJointPoint(confidentFrames, videoWidth, videoHeight, "wristMid");
    const hip = medianJointPoint(confidentFrames, videoWidth, videoHeight, "hipMid");
    const knee = medianJointPoint(confidentFrames, videoWidth, videoHeight, "kneeMid");
    const ankle = medianJointPoint(confidentFrames, videoWidth, videoHeight, "ankleMid");

    if ([shoulder, elbow, wrist, hip, knee, ankle].some((p) => !p)) {
      return {
        status: "low_confidence",
        message: "Some key joints weren't visible clearly enough to analyze.",
      };
    }

    const faults = [];

    // 1️⃣ Elbow support angle — should be a moderate bend, not locked
    // straight and not collapsed.
    const elbowAngle = angleBetween(wrist, elbow, shoulder);
    if (elbowAngle !== null) {
      if (elbowAngle > ELBOW_TOO_STRAIGHT_THRESHOLD) {
        faults.push({
          id: "arm_too_straight",
          severity: elbowAngle > ELBOW_TOO_STRAIGHT_THRESHOLD + 20 ? "major" : "moderate",
          detail: `Your support arm is nearly straight (~${elbowAngle.toFixed(0)}°) instead of posted at a bent angle — bend your elbow more to create a proper lever.`,
        });
      } else if (elbowAngle < ELBOW_TOO_COLLAPSED_THRESHOLD) {
        faults.push({
          id: "arm_collapsed",
          severity: elbowAngle < ELBOW_TOO_COLLAPSED_THRESHOLD - 15 ? "major" : "moderate",
          detail: `Your support arm is folding in tight (~${elbowAngle.toFixed(0)}°) instead of posting up — press through your palm to open the angle back out a bit.`,
        });
      }
    }

    // 2️⃣ Elbow tuck — the elbow should sit close against the hip/waist,
    // not out in space, since that's the actual support point.
    const upperArmLength = distance(shoulder, elbow) || 1;
    const elbowHipDistance = distance(elbow, hip);
    const tuckRatio = elbowHipDistance === null ? null : elbowHipDistance / upperArmLength;
    if (tuckRatio !== null && tuckRatio > ELBOW_TUCK_RATIO_WARNING) {
      faults.push({
        id: "elbow_not_tucked",
        severity: tuckRatio > ELBOW_TUCK_RATIO_MAJOR ? "major" : "moderate",
        detail: "Your elbow isn't tucked in close to your hip — bring it in tighter against your waist so it can actually support your weight.",
      });
    }

    // 3️⃣ Body straightness — shoulder-hip-ankle should be one straight
    // line, same check as handstand.js, just held horizontally instead of
    // vertically (angleBetween doesn't care which orientation the straight
    // line points in).
    const bodyAlignAngle = angleBetween(shoulder, hip, ankle);
    const bodyAlignDeviation = bodyAlignAngle === null ? 0 : Math.abs(180 - bodyAlignAngle);
    if (bodyAlignDeviation > BODY_ALIGN_DEVIATION_THRESHOLD) {
      faults.push({
        id: "body_line_break",
        severity: bodyAlignDeviation > 25 ? "major" : "moderate",
        detail: `Your body isn't in one straight line from shoulders to ankles (~${bodyAlignDeviation.toFixed(0)}° off) — brace your core so your hips don't sag or pike relative to your shoulders and legs.`,
      });
    }

    // 4️⃣ Leg straightness — hip-knee-ankle should be ~180° (knees locked,
    // legs fully extended)
    const legAngle = angleBetween(hip, knee, ankle);
    const legDeviation = legAngle === null ? 0 : 180 - legAngle;
    if (legDeviation > LEG_BEND_DEVIATION_THRESHOLD) {
      faults.push({
        id: "bent_legs",
        severity: legDeviation > 25 ? "major" : "moderate",
        detail: `Knees are bent roughly ${legDeviation.toFixed(0)}° instead of staying straight and extended.`,
      });
    }

    // 5️⃣ Level with the ground — a straight body line held at a steep
    // pitch still passes the check above, so this measures the tilt of the
    // shoulder->ankle line against true horizontal directly. Direction is
    // reported here (unlike L-sit's torso lean) because sagging vs. lifting
    // is readable from the image's vertical axis regardless of which way
    // the athlete faces the camera.
    const tiltDegrees = tiltFromHorizontalDegrees(shoulder, ankle);
    if (tiltDegrees !== null && Math.abs(tiltDegrees) > LEVEL_DEVIATION_WARNING) {
      faults.push({
        id: tiltDegrees > 0 ? "hips_sagging" : "hips_too_high",
        severity: Math.abs(tiltDegrees) > LEVEL_DEVIATION_MAJOR ? "major" : "moderate",
        detail:
          tiltDegrees > 0
            ? `Your body is tilted roughly ${Math.abs(tiltDegrees).toFixed(0)}° off level, with your legs dropping toward the ground — engage your hip flexors to lift your legs back level with your shoulders.`
            : `Your body is tilted roughly ${Math.abs(tiltDegrees).toFixed(0)}° off level, with your legs lifted higher than your shoulders — lower your legs slightly to bring your whole body parallel to the ground.`,
      });
    }

    // --- Final score: start at 100, subtract per fault by severity ---
    const severityPenalty = { moderate: 8, major: 18 };
    let score = 100;
    faults.forEach((f) => {
      score -= severityPenalty[f.severity] || 0;
    });
    score = Math.max(0, Math.round(score));

    return {
      status: "ok",
      score,
      faults,
      angles: {
        elbowAngle: round1(elbowAngle),
        tuckRatio: tuckRatio === null ? null : round1(tuckRatio),
        bodyAlignAngle: round1(bodyAlignAngle),
        legAngle: round1(legAngle),
        tiltDegrees: round1(tiltDegrees),
      },
    };
  };
})();